import 'server-only';
import { getRecognitionRuntime } from '../recognition/runtime';
import { createRecognitionHandlers } from './recognition-handlers';
export const recognitionHandlers = createRecognitionHandlers(getRecognitionRuntime);
