function loadMainWithPackagedState(isPackaged) {
  jest.resetModules();

  const menu = {
    buildFromTemplate: jest.fn(() => ({
      getMenuItemById: jest.fn(() => ({ checked: false })),
    })),
    setApplicationMenu: jest.fn(),
  };

  jest.doMock('electron', () => ({
    app: {
      isPackaged,
      whenReady: jest.fn(() => ({ then: jest.fn() })),
      on: jest.fn(),
      quit: jest.fn(),
      requestSingleInstanceLock: jest.fn(() => true),
      setDesktopName: jest.fn(),
    },
    BrowserWindow: jest.fn(),
    Menu: menu,
    ipcMain: { handle: jest.fn() },
    shell: { openExternal: jest.fn() },
  }));
  jest.doMock('../../src/models/MainModelClass', () => ({
    MainModelClass: jest.fn(),
  }));

  const main = require('../../electron/main');
  return { main, menu };
}

describe('application menu configuration', () => {
  afterEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  test('installs the development application menu with React Developer Tools', () => {
    const { main, menu } = loadMainWithPackagedState(false);

    main.configureApplicationMenu();

    expect(menu.buildFromTemplate).toHaveBeenCalledWith(
      expect.arrayContaining([
        { role: 'fileMenu' },
        { role: 'editMenu' },
        expect.objectContaining({
          label: 'View',
          submenu: expect.arrayContaining([
            { role: 'reload' },
            { role: 'forceReload' },
            { role: 'toggleDevTools' },
            expect.objectContaining({ id: 'react-devtools-toggle', label: 'React Developer Tools' }),
          ]),
        }),
        { role: 'windowMenu' },
        { role: 'help' },
      ])
    );
    expect(menu.setApplicationMenu).toHaveBeenCalledWith(expect.any(Object));
  });

  test('removes the production application menu without building the development menu', () => {
    const { main, menu } = loadMainWithPackagedState(true);

    main.configureApplicationMenu();

    expect(menu.buildFromTemplate).not.toHaveBeenCalled();
    expect(menu.setApplicationMenu).toHaveBeenCalledWith(null);
  });
});
