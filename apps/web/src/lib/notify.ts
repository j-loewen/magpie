import { notifications } from '@mantine/notifications';
import { errorMessage } from '../api';

export const notifyError = (err: unknown) =>
  notifications.show({ color: 'red', title: 'Something went wrong', message: errorMessage(err) });

export const notifyOk = (message: string) => notifications.show({ message });

/** Custom drag data type for dragging notes onto folders. */
export const NOTE_DRAG_TYPE = 'application/x-notes-note';
