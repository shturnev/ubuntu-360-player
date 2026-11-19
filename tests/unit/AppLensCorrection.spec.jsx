import '@testing-library/jest-dom';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import App from '../../src/App.jsx';

jest.mock('../../src/components/InsvViewer.jsx', () => {
  const React = require('react');
  return React.forwardRef(function MockInsvViewer({ lensFieldOfView }, ref) {
    React.useImperativeHandle(ref, () => ({ pause: () => {} }));
    return <div data-testid="insv-viewer" data-lens-fov={lensFieldOfView} />;
  });
});

jest.mock('../../src/PanoramaViewer.jsx', () => {
  const React = require('react');
  return React.forwardRef(function MockPanoramaViewer({ source }, ref) {
    React.useImperativeHandle(ref, () => ({ pause: () => {} }));
    return <div data-testid="panorama-viewer" data-src={source} />;
  });
});

describe('INSP lens and orientation corrections', () => {
  let api;
  let listeners;
  let container;
  const item = {
    type: 'image',
    insp: true,
    origPath: '/images/photo.INSP',
    bigName: 'old.jpg',
    thumpName: 'old.jpg',
    lensFieldOfView: 199,
  };

  beforeEach(() => {
    listeners = {};
    api = {
      send: jest.fn(),
      on: jest.fn((channel, listener) => {
        listeners[channel] = listener;
        return () => {};
      }),
      cancelInspLensCorrection: jest.fn(),
      saveInspLensCorrection: jest.fn(),
      saveOrientationCorrection: jest.fn(),
    };
    window.shtVR = api;
    ({ container } = render(<App />));
    act(() => {
      listeners['start-file-server']({}, 'http://localhost:3000/');
      listeners['start-read-dir']({}, 1);
      listeners['read-media-file']({}, item);
      listeners['import-finished']();
    });
    fireEvent.click(container.querySelector('.media-card'));
  });

  afterEach(() => delete window.shtVR);

  test('shows both controls and updates preview and thumbnail only after successful restitching', async () => {
    api.saveInspLensCorrection.mockResolvedValue({
      success: true,
      bigName: 'new-big.jpg',
      thumpName: 'new-thumb.jpg',
      lensFieldOfView: 210,
      lensFovOverride: true,
    });
    expect(screen.getByRole('button', { name: 'Adjust panorama orientation' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Adjust lens field of view' }));
    fireEvent.change(screen.getByLabelText('Lens FOV (degrees)'), { target: { value: '210' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save lens correction' }));
    await waitFor(() =>
      expect(container.querySelector('.media-card .thumb').style.backgroundImage).toContain('new-thumb.jpg')
    );
    expect(screen.getByTestId('panorama-viewer')).toHaveAttribute('data-src', expect.stringContaining('new-big.jpg'));
    expect(api.saveInspLensCorrection).toHaveBeenCalledWith({
      origPath: item.origPath,
      requestId: 1,
      insp: true,
      value: 210,
    });
  });

  test('applies saved orientation result and cancels pending orientation when closing', async () => {
    api.saveOrientationCorrection.mockResolvedValueOnce({
      success: true,
      bigName: 'rotated.jpg',
      thumpName: 'rotated.jpg',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Adjust panorama orientation' }));
    fireEvent.change(screen.getByLabelText('Yaw correction value'), { target: { value: '10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    await waitFor(() =>
      expect(container.querySelector('.media-card .thumb').style.backgroundImage).toContain('rotated.jpg')
    );
    expect(api.saveOrientationCorrection).toHaveBeenCalledWith({
      origPath: item.origPath,
      orientation: { yaw: 10, pitch: 0, roll: 0 },
      requestId: 1,
    });
    let finish;
    api.saveOrientationCorrection.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Adjust panorama orientation' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save correction' }));
    fireEvent.click(container.querySelector('.close-viewer'));
    expect(api.cancelInspLensCorrection).toHaveBeenCalledWith({
      origPath: item.origPath,
      requestId: 2,
      insp: true,
      orientation: true,
    });
    await act(async () => finish({ success: true, bigName: 'stale.jpg', thumpName: 'stale.jpg' }));
    expect(container.querySelector('.media-card .thumb').style.backgroundImage).toContain('rotated.jpg');
  });
});

describe('INSV lens correction integration', () => {
  let api;
  let listeners;
  let container;
  const item = {
    type: 'video',
    insv: true,
    origPath: '/video/VID_00_01.INSV',
    bigName: 'old.jpg',
    thumpName: 'old.jpg',
    insvToken: 'token',
    lensFieldOfView: 183.3,
  };

  beforeEach(() => {
    listeners = {};
    api = {
      send: jest.fn(),
      on: jest.fn((channel, listener) => {
        listeners[channel] = listener;
        return () => {};
      }),
      cancelInsvLensCorrection: jest.fn(),
      saveInsvLensCorrection: jest.fn(),
    };
    window.shtVR = api;
    ({ container } = render(<App />));
    act(() => {
      listeners['start-file-server']({}, 'http://localhost:3000/');
      listeners['start-read-dir']({}, 1);
      listeners['read-media-file']({}, item);
      listeners['import-finished']();
    });
    fireEvent.click(container.querySelector('.media-card'));
    fireEvent.click(screen.getByRole('button', { name: 'Adjust lens field of view' }));
  });

  afterEach(() => {
    delete window.shtVR;
  });

  test('updates the displayed projection and thumbnail only after a successful save', async () => {
    api.saveInsvLensCorrection.mockResolvedValue({
      success: true,
      thumpName: 'new.jpg',
      lensFieldOfView: 200,
      lensFovOverride: true,
    });
    fireEvent.change(screen.getByLabelText('Lens FOV (degrees)'), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save lens correction' }));
    await waitFor(() => expect(screen.getByTestId('insv-viewer')).toHaveAttribute('data-lens-fov', '200'));
    expect(api.saveInsvLensCorrection).toHaveBeenCalledWith({ origPath: item.origPath, requestId: 1, value: 200 });
    expect(container.querySelector('.media-card .thumb').style.backgroundImage).toContain('new.jpg');
    expect(screen.getByRole('status')).toHaveTextContent('Lens correction saved.');
  });

  test('cancels a pending save when the viewer closes and ignores its late result', async () => {
    let finish;
    api.saveInsvLensCorrection.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save lens correction' }));
    expect(screen.getByText('Saving…')).toBeDisabled();
    fireEvent.click(container.querySelector('.close-viewer'));
    expect(api.cancelInsvLensCorrection).toHaveBeenCalledWith({ origPath: item.origPath, requestId: 1 });
    await act(async () => finish({ success: true, thumpName: 'new.jpg', lensFieldOfView: 200 }));
    expect(container.querySelector('.media-card .thumb').style.backgroundImage).toContain('old.jpg');
    expect(screen.queryByTestId('insv-viewer')).not.toBeInTheDocument();
  });

  test('shows a save error without changing the displayed projection', async () => {
    api.saveInsvLensCorrection.mockResolvedValue({ success: false, message: 'Storage unavailable' });
    fireEvent.change(screen.getByLabelText('Lens FOV (degrees)'), { target: { value: '200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save lens correction' }));
    expect(await screen.findByText('Storage unavailable')).toBeInTheDocument();
    expect(screen.getByTestId('insv-viewer')).toHaveAttribute('data-lens-fov', '183.3');
    expect(container.querySelector('.media-card .thumb').style.backgroundImage).toContain('old.jpg');
  });

  test('does not expose lens correction for ordinary images', () => {
    act(() => {
      listeners['start-read-dir']({}, 1);
      listeners['read-media-file'](
        {},
        {
          type: 'image',
          origPath: '/video/photo.jpg',
          thumpName: 'photo.jpg',
          bigName: 'photo.jpg',
        }
      );
      listeners['import-finished']();
    });
    fireEvent.click(container.querySelector('.media-card'));
    expect(screen.queryByRole('button', { name: 'Adjust lens field of view' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Adjust panorama orientation' })).toBeInTheDocument();
  });
});
