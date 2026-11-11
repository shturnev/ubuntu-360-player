const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('startReactDevTools', () => {
  const devtools = require('react-devtools-core/standalone').default;

  devtools
    .setContentDOMNode(document.getElementById('container'))
    .setStatusListener((message) => {
      const status = document.getElementById('status');
      if (status) {
        status.textContent = message;
      }
    })
    .startServer();
});
