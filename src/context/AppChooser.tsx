import { createContext, useContext } from 'react';

// Lets the portal shell offer a way back to the app chooser.
//
// Non-staff users reach the portal through ClientEntry, which remembers where
// they chose to go. Choosing "Client Portal" used to be a one-way door: the
// "Switch app" control lives in the full-screen app wrapper, so once inside the
// portal there was nothing to return to the chooser with — the only way out was
// to sign out entirely and back in.
//
// ClientEntry provides this around the portal; AppShell consumes it. Staff never
// go through ClientEntry, so for them the context is null and nothing is shown.
// It lives in its own file so the shell does not have to import from ClientEntry,
// which imports the shell in turn.
export type AppChooserValue = {
  backToApps: () => void;
  /** False when the portal is this person's only destination — then there is
   *  nothing to switch to and the control would be a dead end. */
  canChoose: boolean;
};

export const AppChooserContext = createContext<AppChooserValue | null>(null);
export const useAppChooser = () => useContext(AppChooserContext);
