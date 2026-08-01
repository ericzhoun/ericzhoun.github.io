export function createAdminDataClient(invoke) {
  const rows = async (operation, resource, detail = {}) => {
    const result = await invoke("admin-data", { operation, resource, ...detail });
    return result.rows || [];
  };

  return {
    read(resource, query = {}) {
      return rows("read", resource, { query });
    },
    create(resource, fields) {
      return rows("create", resource, { fields });
    },
    update(resource, id, fields) {
      return rows("update", resource, { id, fields });
    },
    async remove(resource, id) {
      const result = await invoke("admin-data", { operation: "delete", resource, id });
      return result.deleted === true;
    },
  };
}
