import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import SettingsPanel from '../../src/components/SettingsPanel.jsx';

test('saves the INSV lens default and reports the result', async () => {
  const save = jest.fn().mockResolvedValue(undefined);
  render(<SettingsPanel insvLensFov={183.3} onSaveInsvLensFov={save} onUpdateSetting={jest.fn()} />);
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
  fireEvent.click(screen.getByRole('button', { name: 'Save INSV lens FOV' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Storage unavailable');
});

test('rejects invalid input without calling the bridge', () => {
  const save = jest.fn();
  render(<SettingsPanel insvLensFov={183.3} onSaveInsvLensFov={save} onUpdateSetting={jest.fn()} />);
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
  fireEvent.change(screen.getByLabelText('INSP lens field of view (degrees)'), { target: { value: '207.5' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save INSP lens FOV' }));
  await waitFor(() => expect(saveInsp).toHaveBeenCalledWith(207.5));
  expect(saveInsv).not.toHaveBeenCalled();
  expect(screen.getByLabelText('INSV lens field of view (degrees)')).toHaveValue(183.3);
});
