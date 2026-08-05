// Artwork photo lifecycle: upload-url, download-urls, delete.
// Photos are stored in Butterbase Storage; the durable reference (objectId) is
// kept in artwork_photos. Because end-users can only download files THEY
// uploaded, this function mints presigned URLs server-side using SERVICE_KEY
// and gates every operation on ownership (the photo's student must belong to
// the caller; admins may act on any student).
// HTTP trigger: auth "required". Storage calls use the service key (ctx.env).
export async function handler(req, ctx) {
  if (!ctx.user) return json({ error: "Authentication required" }, 401);

  let body;
  try { body = await req.json(); } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const action = body.action;
  const isAdminUser = isAdmin(ctx.user.email);
  const apiBase = ctx.env.BUTTERBASE_API_URL || "https://api.butterbase.ai";
  const appId = ctx.env.BUTTERBASE_APP_ID;
  const serviceKey = ctx.env.SERVICE_KEY;

  if (action === "upload-url") return uploadUrl(ctx, body, isAdminUser, apiBase, appId, serviceKey);
  if (action === "download-urls") return downloadUrls(ctx, body, isAdminUser, apiBase, appId, serviceKey);
  if (action === "delete") return del(ctx, body, isAdminUser, apiBase, appId, serviceKey);
  return json({ error: "Unknown action" }, 400);
}

// Returns a presigned PUT url + inserts the metadata row (so abandoned uploads
// are still trackable, mirroring the pending-enrollment pattern). The client
// PUTs the file bytes to upload_url afterwards.
async function uploadUrl(ctx, body, isAdminUser, apiBase, appId, serviceKey) {
  const studentId = str(body.student_id);
  const filename = str(body.filename);
  const contentType = str(body.content_type) || "image/jpeg";
  const sizeBytes = parseInt(body.size_bytes, 10);

  if (!studentId) return json({ error: "student_id is required" }, 400);
  if (!filename) return json({ error: "filename is required" }, 400);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return json({ error: "size_bytes must be a positive number" }, 400);
  }
  if (sizeBytes > 10 * 1024 * 1024) {
    return json({ error: "File too large (10 MB max)" }, 400);
  }
  if (!/^image\//.test(contentType)) {
    return json({ error: "Only image files are allowed" }, 400);
  }

  // Ownership: the student must belong to the caller (unless admin).
  const student = await ownedStudent(ctx, studentId, isAdminUser);
  if (!student) return json({ error: "Student not found" }, 404);

  // Mint the presigned upload URL with the service key.
  const upRes = await fetch(`${apiBase}/storage/${appId}/upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${serviceKey}`,
    },
    body: JSON.stringify({ filename, contentType, sizeBytes }),
  });
  const upData = await upRes.json().catch(() => ({}));
  if (!upRes.ok) {
    return json({ error: upData.error || "Could not create upload URL" }, 502);
  }

  const caption = str(body.caption);
  const photoRes = await ctx.db.query(
    `INSERT INTO artwork_photos (student_id, storage_object_id, caption, uploaded_by)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [studentId, upData.objectId, caption, isAdminUser ? "admin" : "parent"]
  );
  return json({
    photo_id: photoRes.rows[0].id,
    object_id: upData.objectId,
    upload_url: upData.uploadUrl,
  }, 200);
}

// Mints short-lived download URLs for the given photo ids. Photos whose student
// the caller doesn't own are silently skipped (RLS on artwork_photos would also
// hide them if we queried as the user; we query as service + re-check ownership
// here so the same code path serves admin and parent).
async function downloadUrls(ctx, body, isAdminUser, apiBase, appId, serviceKey) {
  const ids = Array.isArray(body.photo_ids) ? body.photo_ids.filter(Boolean) : [];
  if (ids.length === 0) return json({ photos: [] }, 200);

  // Fetch the requested rows + their owning user_id.
  const res = await ctx.db.query(
    `SELECT ap.id, ap.student_id, ap.storage_object_id, ap.caption, ap.uploaded_by, ap.created_at, s.user_id
     FROM artwork_photos ap
     JOIN students s ON s.id = ap.student_id
     WHERE ap.id = ANY($1::uuid[])`,
    [ids]
  );

  const visible = isAdminUser
    ? res.rows
    : res.rows.filter((r) => r.user_id === ctx.user.id);

  // Resolve download URLs in parallel (1-hour TTL each).
  const photos = await Promise.all(visible.map(async (r) => {
    try {
      const dlRes = await fetch(`${apiBase}/storage/${appId}/download/${r.storage_object_id}`, {
        headers: { Authorization: `Bearer ${serviceKey}` },
      });
      const dl = await dlRes.json().catch(() => ({}));
      if (!dlRes.ok) return null;
      return {
        id: r.id,
        student_id: r.student_id,
        caption: r.caption,
        uploaded_by: r.uploaded_by,
        created_at: r.created_at,
        download_url: dl.downloadUrl,
      };
    } catch {
      return null;
    }
  }));

  return json({ photos: photos.filter(Boolean) }, 200);
}

// Deletes the storage object (service key) and the metadata row.
async function del(ctx, body, isAdminUser, apiBase, appId, serviceKey) {
  const photoId = str(body.photo_id);
  if (!photoId) return json({ error: "photo_id is required" }, 400);

  const res = await ctx.db.query(
    `SELECT ap.id, ap.storage_object_id, s.user_id
     FROM artwork_photos ap
     JOIN students s ON s.id = ap.student_id
     WHERE ap.id = $1`,
    [photoId]
  );
  if (res.rows.length === 0) return json({ error: "Photo not found" }, 404);
  const row = res.rows[0];
  if (!isAdminUser && row.user_id !== ctx.user.id) {
    return json({ error: "Photo not found" }, 404);
  }

  // Best-effort object deletion; the metadata row is the source of truth.
  try {
    await fetch(`${apiBase}/storage/${appId}/${row.storage_object_id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${serviceKey}` },
    });
  } catch {
    // ignore — row deletion still removes it from the parent's view
  }
  await ctx.db.query(`DELETE FROM artwork_photos WHERE id = $1`, [photoId]);
  return json({ deleted: true }, 200);
}

// Returns the student row if the caller owns it (or is admin).
async function ownedStudent(ctx, studentId, isAdminUser) {
  const res = await ctx.db.query(
    `SELECT * FROM students WHERE id = $1${isAdminUser ? "" : " AND user_id = $2"}`,
    isAdminUser ? [studentId] : [studentId, ctx.user.id]
  );
  return res.rows[0] || null;
}

function isAdmin(email) {
  return email === "herfield8@gmail.com" ||
    email === "lightbyolivia@gmail.com" ||
    email === "olivistastudio@gmail.com";
}

function str(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
