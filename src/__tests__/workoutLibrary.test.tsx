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
  canUseSession: false,
  plannedWorkouts: [],
  plannedLoading: false,
  plannedError: null,
  onLoadPlanned: vi.fn().mockResolvedValue(undefined),
  onAddPlanned: vi.fn(),
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

  it('tells a signed-out rower that signing in avoids the form', () => {
    render(<WorkoutLibrary {...props({ canUseSession: false })} />);
    expect(screen.getByText(/sign in with intervals\.icu/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/api key/i)).toBeVisible();
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

describe('WorkoutLibrary for a signed-in rower', () => {
  const signedIn = (over: Partial<React.ComponentProps<typeof WorkoutLibrary>> = {}) =>
    props({ canUseSession: true, ...over });

  it('offers the calendar instead of asking for credentials', () => {
    render(<WorkoutLibrary {...signedIn()} />);

    expect(screen.getByRole('button', { name: /load planned workouts/i })).toBeInTheDocument();
    // The credential form is still reachable, but not in the way.
    expect(screen.getByLabelText(/api key/i)).not.toBeVisible();
    expect(screen.queryByText(/sign in with intervals\.icu/i)).not.toBeInTheDocument();
  });

  it('loads the planned workouts when asked', async () => {
    const onLoadPlanned = vi.fn().mockResolvedValue(undefined);
    render(<WorkoutLibrary {...signedIn({ onLoadPlanned })} />);

    await userEvent.click(screen.getByRole('button', { name: /load planned workouts/i }));
    expect(onLoadPlanned).toHaveBeenCalledTimes(1);
  });

  it('says it is working while the calendar is being fetched', () => {
    render(<WorkoutLibrary {...signedIn({ plannedLoading: true })} />);
    const button = screen.getByRole('button', { name: /loading/i });
    expect(button).toBeDisabled();
  });

  it('lists each planned workout with what it will cost', () => {
    const planned = aWorkout({ id: 'icu-plan-1', name: 'Tuesday intervals', source: 'intervals.icu' });
    render(<WorkoutLibrary {...signedIn({ plannedWorkouts: [planned] })} />);

    const entry = screen.getByText('Tuesday intervals').closest('.workout-planned-item')!;
    expect(entry).toBeInTheDocument();
    expect(within(entry as HTMLElement).getByText(/1 segment · 10:00/)).toBeInTheDocument();
  });

  it('adds a planned workout to the library when picked', async () => {
    const planned = aWorkout({ id: 'icu-plan-1', name: 'Tuesday intervals' });
    const onAddPlanned = vi.fn();
    render(<WorkoutLibrary {...signedIn({ plannedWorkouts: [planned], onAddPlanned })} />);

    await userEvent.click(screen.getByRole('button', { name: /use this$/i }));
    expect(onAddPlanned).toHaveBeenCalledWith(planned);
  });

  it('says so when the calendar has nothing rowing in it', async () => {
    render(<WorkoutLibrary {...signedIn({ plannedWorkouts: [] })} />);

    await userEvent.click(screen.getByRole('button', { name: /load planned workouts/i }));
    expect(await screen.findByText(/no planned rowing workouts/i)).toBeInTheDocument();
  });

  it('does not claim an empty calendar before one has been asked for', () => {
    render(<WorkoutLibrary {...signedIn()} />);
    expect(screen.queryByText(/no planned rowing workouts/i)).not.toBeInTheDocument();
  });

  it('reports a calendar failure without hiding the button', () => {
    render(<WorkoutLibrary {...signedIn({ plannedError: 'Unable to load planned workouts (500).' })} />);

    expect(screen.getByRole('alert')).toHaveTextContent('(500)');
    expect(screen.getByRole('button', { name: /load planned workouts/i })).toBeEnabled();
  });

  it('still lets a signed-in rower use a key for someone else', async () => {
    render(<WorkoutLibrary {...signedIn()} />);

    await userEvent.click(screen.getByRole('button', { name: /api key instead/i }));
    expect(screen.getByLabelText(/api key/i)).toBeVisible();
  });
});
