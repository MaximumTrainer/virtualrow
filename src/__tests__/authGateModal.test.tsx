import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AuthGateModal } from '../components/AuthGateModal';
import { AuthProvider } from '../context/AuthContext';

// Suppress console noise
vi.spyOn(console, 'error').mockImplementation(() => {});

function makeServiceStub() {
  return {
    getUser: vi.fn(() => null),
    startLogin: vi.fn(() => Promise.resolve()),
    handleCallback: vi.fn(() => Promise.resolve(null)),
    refreshAccessToken: vi.fn(() => Promise.resolve(false)),
    logout: vi.fn(),
    getAccessToken: vi.fn(() => null),
    scheduleRefresh: vi.fn(),
    get isAuthenticated() { return false; },
  } as unknown as import('../services/authService').AuthService;
}

function renderModal(props: {
  isOpen?: boolean;
  actionDescription?: string;
  onLogin?: () => void;
  onDismiss?: () => void;
}) {
  const onLogin = props.onLogin ?? vi.fn();
  const onDismiss = props.onDismiss ?? vi.fn();
  const service = makeServiceStub();

  render(
    <AuthProvider service={service}>
      <AuthGateModal
        isOpen={props.isOpen ?? true}
        actionDescription={props.actionDescription}
        onLogin={onLogin}
        onDismiss={onDismiss}
      />
    </AuthProvider>
  );

  return { onLogin, onDismiss };
}

describe('AuthGateModal', () => {
  it('renders nothing when isOpen is false', () => {
    renderModal({ isOpen: false });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders the modal when isOpen is true', () => {
    renderModal({ isOpen: true });
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('displays the sign-in title', () => {
    renderModal({ isOpen: true });
    expect(screen.getByText(/sign in to continue/i)).toBeTruthy();
  });

  it('shows the custom action description', () => {
    renderModal({ isOpen: true, actionDescription: 'save your workout history' });
    expect(screen.getByText(/save your workout history/i)).toBeTruthy();
  });

  it('shows generic message when no actionDescription provided', () => {
    renderModal({ isOpen: true });
    expect(screen.getByText(/requires a free intervals\.icu account/i)).toBeTruthy();
  });

  it('calls onLogin when sign-in button is clicked', async () => {
    const user = userEvent.setup();
    const { onLogin } = renderModal({ isOpen: true });

    await user.click(screen.getByRole('button', { name: /sign in with intervals/i }));
    expect(onLogin).toHaveBeenCalledOnce();
  });

  it('calls onDismiss when "Continue as Guest" is clicked', async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderModal({ isOpen: true });

    await user.click(screen.getByRole('button', { name: /continue as guest/i }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('calls onDismiss when the close (✕) button is clicked', async () => {
    const user = userEvent.setup();
    const { onDismiss } = renderModal({ isOpen: true });

    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
