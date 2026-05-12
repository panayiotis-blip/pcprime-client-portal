import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import MFAStepUpModal from '../components/Auth/MFAStepUpModal';

type Resolver = (verified: boolean) => void;

interface MFAStepUpAPI {
  // Run an action. If it throws an error whose message includes the marker
  // 'MFA verification required', show the step-up modal, then retry the action
  // exactly once. On cancel, the wrapped promise rejects with MFA_CANCELLED.
  runWith: <T>(action: () => Promise<T>) => Promise<T>;
}

const MFAStepUpContext = createContext<MFAStepUpAPI | null>(null);

export const MFA_CANCELLED = 'MFA verification cancelled';

function isMfaRequiredError(err: unknown): boolean {
  const msg = (err as any)?.message;
  return typeof msg === 'string' && msg.includes('MFA verification required');
}

export function MFAStepUpProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const resolverRef = useRef<Resolver | null>(null);

  const promptForCode = useCallback((): Promise<boolean> => {
    return new Promise((resolve) => {
      resolverRef.current = resolve;
      setOpen(true);
    });
  }, []);

  const handleVerified = useCallback(() => {
    setOpen(false);
    resolverRef.current?.(true);
    resolverRef.current = null;
  }, []);

  const handleCancel = useCallback(() => {
    setOpen(false);
    resolverRef.current?.(false);
    resolverRef.current = null;
  }, []);

  const runWith = useCallback(async <T,>(action: () => Promise<T>): Promise<T> => {
    try {
      return await action();
    } catch (err) {
      if (!isMfaRequiredError(err)) throw err;
      const verified = await promptForCode();
      if (!verified) throw new Error(MFA_CANCELLED);
      return await action();
    }
  }, [promptForCode]);

  return (
    <MFAStepUpContext.Provider value={{ runWith }}>
      {children}
      {open && <MFAStepUpModal onVerified={handleVerified} onCancel={handleCancel} />}
    </MFAStepUpContext.Provider>
  );
}

export function useMFAStepUp(): MFAStepUpAPI {
  const ctx = useContext(MFAStepUpContext);
  if (!ctx) throw new Error('useMFAStepUp must be used inside MFAStepUpProvider');
  return ctx;
}
