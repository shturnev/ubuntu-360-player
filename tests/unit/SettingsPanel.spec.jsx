import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SettingsPanel from '../../src/components/SettingsPanel.jsx';

test('saves the INSV lens default and reports the result', async () => {
  const save = jest.fn().mockResolvedValue(undefined);
  render(<SettingsPanel insvLensFov={183.3} onSaveInsvLensFov={save} onUpdateSetting={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Lenses' }));
  const input = screen.getByLabelText('INSV lens field of view (degrees)');
  expect(input).toHaveValue(183.3);
  fireEvent.change(input, { target: { value: '200.2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save INSV lens FOV' }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(200.2));
  expect(await screen.findByRole('status')).toHaveTextContent('Applies to subsequent INSV imports');
});

test('shows a settings persistence error', async () => {
  const save = jest.fn().mockRejectedValue(new Error('Storage unavailable'));
  render(<SettingsPanel insvLensFov={183.3} onSaveInsvLensFov={save} onUpdateSetting={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Lenses' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save INSV lens FOV' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Storage unavailable');
});

test('rejects invalid input without calling the bridge', () => {
  const save = jest.fn();
  render(<SettingsPanel insvLensFov={183.3} onSaveInsvLensFov={save} onUpdateSetting={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Lenses' }));
  fireEvent.change(screen.getByLabelText('INSV lens field of view (degrees)'), { target: { value: '179' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Save INSV lens FOV' }).closest('form'));
  expect(save).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toHaveTextContent('between 180 and 220');
});

test('saves the INSP default independently of the INSV default', async () => {
  const saveInsp = jest.fn().mockResolvedValue(undefined);
  const saveInsv = jest.fn();
  render(
    <SettingsPanel
      inspLensFov={199}
      insvLensFov={183.3}
      onSaveInspLensFov={saveInsp}
      onSaveInsvLensFov={saveInsv}
      onUpdateSetting={jest.fn()}
    />
  );
  fireEvent.click(screen.getByRole('button', { name: 'Lenses' }));
  fireEvent.change(screen.getByLabelText('INSP lens field of view (degrees)'), { target: { value: '207.5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save INSP lens FOV' }));
  await waitFor(() => expect(saveInsp).toHaveBeenCalledWith(207.5));
  expect(saveInsv).not.toHaveBeenCalled();
  expect(screen.getByLabelText('INSV lens field of view (degrees)')).toHaveValue(183.3);
});

test('navigates settings sections and keeps general actions available', () => {
  const clearCache = jest.fn();
  const updateSetting = jest.fn();
  render(<SettingsPanel cacheSize={12} onDeleteCache={clearCache} onUpdateSetting={updateSetting} />);
  const navigation = within(screen.getByRole('navigation', { name: 'Settings sections' }));
  expect(navigation.getByRole('button', { name: 'General' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('heading', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Clear data cache (12 MB)' }));
  fireEvent.click(screen.getByLabelText('Check for updates'));
  expect(clearCache).toHaveBeenCalledTimes(1);
  expect(updateSetting).toHaveBeenCalledTimes(1);

  fireEvent.click(navigation.getByRole('button', { name: 'Shortcuts' }));
  expect(navigation.getByRole('button', { name: 'General' })).toHaveAttribute('aria-pressed', 'false');
  expect(navigation.getByRole('button', { name: 'Shortcuts' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible();
  expect(screen.getByText('Toggle orientation correction')).toBeVisible();
  expect(screen.queryByRole('button', { name: /clear data cache/i })).not.toBeInTheDocument();

  fireEvent.click(navigation.getByRole('button', { name: 'About' }));
  expect(screen.getByText('Project website')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Donate' })).toBeVisible();
});

test('preserves lens drafts and validation messages across navigation', () => {
  render(<SettingsPanel inspLensFov={199} insvLensFov={183.3} onUpdateSetting={jest.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Lenses' }));
  fireEvent.change(screen.getByLabelText('INSP lens field of view (degrees)'), { target: { value: '207.5' } });
  fireEvent.change(screen.getByLabelText('INSV lens field of view (degrees)'), { target: { value: '179' } });
  fireEvent.submit(screen.getByRole('button', { name: 'Save INSV lens FOV' }).closest('form'));
  fireEvent.click(screen.getByRole('button', { name: 'General' }));
  fireEvent.click(screen.getByRole('button', { name: 'Lenses' }));
  expect(screen.getByLabelText('INSP lens field of view (degrees)')).toHaveValue(207.5);
  expect(screen.getByLabelText('INSV lens field of view (degrees)')).toHaveValue(179);
  expect(screen.getByRole('status')).toHaveTextContent('between 180 and 220');
});
