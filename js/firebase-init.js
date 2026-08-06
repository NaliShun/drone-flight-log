firebase.initializeApp(firebaseConfig);

const auth = firebase.auth();
const db = firebase.firestore();

// オフライン時もアプリを開けて、後で自動的に同期されるようにする
db.enablePersistence({ synchronizeTabs: true }).catch(() => {
  // 複数タブで開いている・非対応ブラウザの場合は無視（同期は諦めるがアプリは動く）
});
