// School Hub Service Worker
// キャッシュ戦略: アプリシェル(HTML/CSS/JS/アイコン/フォント)をキャッシュし、
// オフラインでもホーム・タスク・カレンダー・成績などが閲覧できるようにする。
// データ自体はアプリ側の localStorage を利用するため、SW はデータを保持しない。

const SW_VERSION = 'v1.0.0';
const STATIC_CACHE = `schoolhub-static-${SW_VERSION}`;

// 同一オリジンのアプリシェル（相対パスなので配置場所を問わず動作する）
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon.png'
];

// 外部リソース（フォント／アイコンフォントスクリプト）。
// クロスオリジンなので opaque レスポンスとしてベストエフォートでキャッシュする。
const EXTERNAL_ASSETS = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Noto+Sans+JP:wght@400;500;700&display=swap',
  'https://unpkg.com/@phosphor-icons/web'
];

// --- install: アプリシェルをキャッシュ ---
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      // 同一オリジンは失敗したらインストール自体を失敗させたいので await
      await cache.addAll(APP_SHELL);
      // 外部リソースは失敗しても致命的にしない（オフラインビルド環境などを考慮）
      await Promise.all(
        EXTERNAL_ASSETS.map(async (url) => {
          try {
            const req = new Request(url, { mode: 'no-cors' });
            const res = await fetch(req);
            await cache.put(req, res);
          } catch (e) {
            // 取得できなくても致命的エラーにしない
            console.warn('[SW] external asset cache failed:', url, e);
          }
        })
      );
    })()
  );
  // 新しい SW をすぐ待機状態にする（有効化はユーザーの更新確認後に SKIP_WAITING で行う）
});

// --- activate: 古いバージョンのキャッシュを削除 ---
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('schoolhub-static-') && key !== STATIC_CACHE)
          .map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

// --- message: ページ側からの SKIP_WAITING 指示を受けて即時有効化 ---
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// --- fetch: ナビゲーションは network-first（オフライン時のみキャッシュ）、
//            その他の静的アセットは cache-first で高速化 ---
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // GET 以外（POST 等）はそのまま素通し
  if (request.method !== 'GET') return;

  const isNavigation = request.mode === 'navigate';

  if (isNavigation) {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetch(request);
          const cache = await caches.open(STATIC_CACHE);
          cache.put('./index.html', networkResponse.clone());
          return networkResponse;
        } catch (e) {
          // オフライン: キャッシュ済みのアプリ本体を返す
          const cache = await caches.open(STATIC_CACHE);
          const cached = await cache.match('./index.html');
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  // 静的アセット（CSS/JS/画像/フォント等）: cache-first、裏で更新
  event.respondWith(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      const cached = await cache.match(request, { ignoreVary: true });

      const fetchAndUpdate = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && (networkResponse.ok || networkResponse.type === 'opaque')) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        })
        .catch(() => null);

      // キャッシュがあれば即返し、なければネットワークを待つ
      return cached || (await fetchAndUpdate) || Response.error();
    })()
  );
});
