import { useState } from 'react';
import { Navigate } from '@tanstack/react-router';
import { newId } from '../api';
import { planShare, type ShareTargetSearch } from '../lib/share';

export type { ShareTargetSearch };

export function ShareTargetPage({ shared }: { shared: ShareTargetSearch }) {
  const plan = planShare(shared);
  const [noteId] = useState(newId);
  if (!plan.url && !plan.text && !plan.title) return <Navigate to="/" replace />;
  const { type, ...rest } = plan;
  const fields = Object.fromEntries(Object.entries(rest).filter(([, v]) => v));
  // A new note in Home, open in the dialog. Replace, so going back does not land here (and start
  // another note) again.
  return <Navigate to="/" search={{ note: noteId, new: type, ...fields }} replace />;
}
