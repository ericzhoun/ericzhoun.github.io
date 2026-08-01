export function createAdminCaller({ getToken, refreshToken, callFunction }) {
  return async (action, body = {}) => {
    const request = (token) => callFunction("admin-manage", { action, ...body }, token);
    let token = getToken();
    if (!token) token = await refreshToken();
    if (!token) throw new Error("Your admin session has expired. Please log in again.");

    try {
      return await request(token);
    } catch (error) {
      if (error?.status !== 401 && error?.status !== 403) throw error;
      const refreshed = await refreshToken();
      if (!refreshed || refreshed === token) throw error;
      return request(refreshed);
    }
  };
}
