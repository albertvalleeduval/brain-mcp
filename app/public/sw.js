/* Service worker — la coquille de l'app, disponible hors ligne.
 *
 * Existe pour une seule raison : /capture doit s'ouvrir dans un tunnel. Sans
 * lui, la file d'attente de CapturePage ne sert à rien puisque la page ne
 * charge même pas. Effet de bord utile : l'app devient une vraie PWA, donc
 * l'appui long sur l'icône et l'affichage plein écran fonctionnent.
 *
 * Règle absolue : /api/* n'est JAMAIS mis en cache. Une idée doit partir sur
 * le réseau ou rester en file d'attente, jamais recevoir une réponse périmée,
 * et le graphe du cockpit ne doit jamais afficher un brain d'hier sans le dire.
 */

const CACHE = "brain-shell-v2";

self.addEventListener("install", (e) => {
  // La coquille : le Worker sert la même page sur tout chemin (SPA fallback),
  // donc "/" suffit à couvrir /capture, /idees et le reste.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/", "/manifest.webmanifest", "/capture.webmanifest"])));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // jamais de cache sur l'API
  if (url.pathname.startsWith("/app/")) return; // login/logout : toujours le réseau

  // Navigation : réseau d'abord pour ne pas figer une version, cache en repli.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/").then((hit) => hit ?? Response.error())),
    );
    return;
  }

  // Assets : leur nom porte un hash de contenu, donc ils sont immuables.
  // Cache d'abord, et on ne remet à jour que ce qu'on n'avait pas.
  e.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
    }),
  );
});
