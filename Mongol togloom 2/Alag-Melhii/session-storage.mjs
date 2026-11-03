// Tokens are server-issued bearer credentials. Never log them or derive identity from names/seats.
export function createSessionStore(persistent, tab) {
  if (arguments.length === 0) {
    try { persistent = globalThis.localStorage; } catch (error) { console.error('[session:local-storage]', error); }
    try { tab = globalThis.sessionStorage; } catch (error) { console.error('[session:tab-storage]', error); }
  }
  const read = (store, key) => { try { return store?.getItem(key); } catch { return null; } };
  return {
    getItem(key) { return read(tab, key) || read(persistent, key) || null; },
    setItem(key, value) {
      for (const store of [persistent, tab]) try { store?.setItem(key, value); } catch (error) { console.error('[session:storage-write]', error); }
    },
    removeItem(key) { for (const store of [persistent, tab]) try { store?.removeItem(key); } catch {} }
  };
}
