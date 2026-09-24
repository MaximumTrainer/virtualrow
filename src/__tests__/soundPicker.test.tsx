import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SoundPicker } from '../components/SoundPicker';

/**
 * Issue #339 — switching the sound on, and setting how loud it is.
 *
 * Off until asked for. A browser will not start an AudioContext without a
 * gesture, so the switch is not a preference the app can honour silently at
 * load — it is the gesture.
 */

describe('the sound picker', () => {
  it('is off to begin with, and says so', () => {
    render(<SoundPicker enabled={false} volume={0.5} onToggle={vi.fn()} onVolume={vi.fn()} />);

    expect(screen.getByRole('switch', { name: /sound/i })).not.toBeChecked();
  });

  it('asks for sound when the rower switches it on', async () => {
    const onToggle = vi.fn();
    render(<SoundPicker enabled={false} volume={0.5} onToggle={onToggle} onVolume={vi.fn()} />);

    await userEvent.click(screen.getByRole('switch', { name: /sound/i }));

    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it('switches back off again', async () => {
    const onToggle = vi.fn();
    render(<SoundPicker enabled volume={0.5} onToggle={onToggle} onVolume={vi.fn()} />);

    await userEvent.click(screen.getByRole('switch', { name: /sound/i }));

    expect(onToggle).toHaveBeenCalledWith(false);
  });

  // A volume slider for sound that is off is a control with nothing to do.
  it('offers a volume only once there is something to hear', () => {
    const { rerender } = render(
      <SoundPicker enabled={false} volume={0.5} onToggle={vi.fn()} onVolume={vi.fn()} />,
    );
    expect(screen.queryByRole('slider', { name: /volume/i })).toBeNull();

    rerender(<SoundPicker enabled volume={0.5} onToggle={vi.fn()} onVolume={vi.fn()} />);
    expect(screen.getByRole('slider', { name: /volume/i })).toBeInTheDocument();
  });

  it('reports the volume the rower set', () => {
    const onVolume = vi.fn();
    render(<SoundPicker enabled volume={0.5} onToggle={vi.fn()} onVolume={onVolume} />);

    // `fireEvent` rather than `userEvent`: a range input is dragged, not
    // typed into, and `userEvent.clear` refuses it as not editable.
    fireEvent.change(screen.getByRole('slider', { name: /volume/i }), {
      target: { value: '0.75' },
    });

    expect(onVolume).toHaveBeenCalledWith(0.75);
  });

  // The number as well as the slider: a slider's position is not a reading,
  // and a rower setting a level over an erg wants to know what they set.
  it('says how loud it is, not only where the handle sits', () => {
    render(<SoundPicker enabled volume={0.35} onToggle={vi.fn()} onVolume={vi.fn()} />);

    expect(screen.getByText('35%')).toBeInTheDocument();
  });

  it('is a switch a screen reader can read as one', () => {
    render(<SoundPicker enabled volume={0.5} onToggle={vi.fn()} onVolume={vi.fn()} />);

    expect(screen.getByRole('switch', { name: /sound/i })).toBeChecked();
    expect(screen.getByRole('slider', { name: /volume/i })).toHaveAttribute(
      'aria-valuetext',
      '50%',
    );
  });
});
