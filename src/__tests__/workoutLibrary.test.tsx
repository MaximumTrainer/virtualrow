import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorkoutLibrary } from '../components/WorkoutLibrary';
import type { StructuredWorkout, WorkoutSegment } from '../types/index';

const segment = (over: Partial<WorkoutSegment> = {}): WorkoutSegment => ({
  id: 's1', order: 0, type: 'work', duration: 600, intensity: 'zone2', ...over,
});

const aWorkout = (over: Partial<StructuredWorkout> = {}): StructuredWorkout => ({
  id: 'w1',
  name: 'Steady State 20',
  description: 'A long steady piece',
  type: 'steady-state',
  segments: [segment()],
  totalDuration: 600,
  targetMetric: 'pace',
  createdAt: new Date(),
  ...over,
});

const props = (over: Partial<React.ComponentProps<typeof WorkoutLibrary>> = {}) => ({
  library: [aWorkout()],
  selected: null,
  onSelect: vi.fn(),
  validationErrors: [],
  onImport: vi.fn().mockResolvedValue({ ok: true }),
  ...over,
});

describe('WorkoutLibrary', () => {
  it('lists each workout with what it will ask of the rower', () => {
    render(<WorkoutLibrary {...props()} />);

    const card = screen.getByRole('listitem');
    expect(within(card).getByText('Steady State 20')).toBeInTheDocument();
    expect(within(card).getByText(/1 segment\b/i)).toBeInTheDocument();
    expect(within(card).getByText(/10:00/)).toBeInTheDocument();
  });

  it('counts a repeated block as the segments it becomes', () => {
    const intervals = aWorkout({
      id: 'w2',
      name: 'Pyramid',
      segments: [segment({ repeat: 4, duration: 60 })],
      totalDuration: 240,
    });
    render(<WorkoutLibrary {...props({ library: [intervals] })} />);
    expect(screen.getByText(/4 segments/i)).toBeInTheDocument();
  });

  it('shows a distance-based workout in metres', () => {
    const distance = aWorkout({
      segments: [segment({ duration: undefined, distance: 2000 })],
      totalDuration: 0,
    });
    render(<WorkoutLibrary {...props({ library: [distance] })} />);
    expect(screen.getByText(/2,000 m/)).toBeInTheDocument();
  });

  it('marks which workout will run next', () => {
    render(<WorkoutLibrary {...props({ selected: aWorkout() })} />);
    expect(screen.getByRole('listitem')).toHaveAttribute('aria-current', 'true');
  });

  it('selects a workout when the rower picks it', async () => {
    const onSelect = vi.fn();
    render(<WorkoutLibrary {...props({ onSelect })} />);

    await userEvent.click(screen.getByRole('button', { name: /use this workout/i }));
    expect(onSelect).toHaveBeenCalledWith('w1');
  });

  it('lets the rower go back to a free row', async () => {
    const onSelect = vi.fn();
    render(<WorkoutLibrary {...props({ selected: aWorkout(), onSelect })} />);

    await userEvent.click(screen.getByRole('button', { name: /free row/i }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it('says so when the library is empty rather than showing a bare list', () => {
    render(<WorkoutLibrary {...props({ library: [] })} />);
    expect(screen.getByText(/no workouts yet/i)).toBeInTheDocument();
  });

  it('surfaces why a selected workout cannot be started', () => {
    render(
      <WorkoutLibrary
        {...props({
          selected: aWorkout(),
          validationErrors: ['"Hard bit" has neither a duration nor a distance.'],
        })}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/neither a duration nor a distance/i);
  });

  it('imports a workout from intervals.icu with the details entered', async () => {
    const onImport = vi.fn().mockResolvedValue({ ok: true });
    render(<WorkoutLibrary {...props({ onImport })} />);

    await userEvent.type(screen.getByLabelText(/api key/i), 'secret-key');
    await userEvent.type(screen.getByLabelText(/athlete id/i), 'i12345');
    await userEvent.type(screen.getByLabelText(/workout id/i), '987');
    await userEvent.click(screen.getByRole('button', { name: /^import$/i }));

    expect(onImport).toHaveBeenCalledWith('secret-key', 'i12345', '987');
  });

  it('will not import until every detail is present', async () => {
    const onImport = vi.fn();
    render(<WorkoutLibrary {...props({ onImport })} />);

    await userEvent.type(screen.getByLabelText(/api key/i), 'secret-key');
    expect(screen.getByRole('button', { name: /^import$/i })).toBeDisabled();
    expect(onImport).not.toHaveBeenCalled();
  });

  it('reports an import failure without losing what was typed', async () => {
    const onImport = vi.fn().mockResolvedValue({ ok: false, error: '401 Unauthorized' });
    render(<WorkoutLibrary {...props({ onImport })} />);

    await userEvent.type(screen.getByLabelText(/api key/i), 'bad-key');
    await userEvent.type(screen.getByLabelText(/athlete id/i), 'i12345');
    await userEvent.type(screen.getByLabelText(/workout id/i), '987');
    await userEvent.click(screen.getByRole('button', { name: /^import$/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('401 Unauthorized');
    expect(screen.getByLabelText(/athlete id/i)).toHaveValue('i12345');
  });

  it('never puts the api key in the DOM as readable text', async () => {
    render(<WorkoutLibrary {...props()} />);
    const key = screen.getByLabelText(/api key/i);
    await userEvent.type(key, 'secret-key');
    expect(key).toHaveAttribute('type', 'password');
  });

  it('clears the import form once a workout comes back', async () => {
    const onImport = vi.fn().mockResolvedValue({ ok: true });
    render(<WorkoutLibrary {...props({ onImport })} />);

    await userEvent.type(screen.getByLabelText(/api key/i), 'secret-key');
    await userEvent.type(screen.getByLabelText(/athlete id/i), 'i12345');
    await userEvent.type(screen.getByLabelText(/workout id/i), '987');
    await userEvent.click(screen.getByRole('button', { name: /^import$/i }));

    expect(await screen.findByText(/imported/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/workout id/i)).toHaveValue('');
  });
});
