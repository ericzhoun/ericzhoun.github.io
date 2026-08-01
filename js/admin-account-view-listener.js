export function createLatestEventListener() {
  let activeController;

  return {
    listen(target, type, listener) {
      activeController?.abort();
      activeController = new AbortController();
      target.addEventListener(type, listener, { signal: activeController.signal });
    },
    clear() {
      activeController?.abort();
      activeController = undefined;
    },
  };
}
