import { logger } from './logger';
import { execSync } from 'child_process';

export interface TimeoutResult {
  aborted: boolean;
}

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  errorMessage: string
): Promise<T> {
  let timer: NodeJS.Timeout;
  const abortController = { aborted: false };

  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => {
      abortController.aborted = true;
      // نسجل التحذير—العملية مستمرة في الخلفية لكننا تجاهلناها
      reject(new Error(`TIMEOUT: ${errorMessage} after ${ms}ms`));
    }, ms);
  });

  // نلف الـ promise الأصلي لنتجاهل نتيجته إذا كان قد أُلغي
  const wrappedPromise = promise.then(
    (result) => {
      clearTimeout(timer);
      if (abortController.aborted) {
        logger.warn(`Operation completed after timeout was triggered: ${errorMessage}`);
        throw new Error('Operation completed but was already aborted');
      }
      return result;
    },
    (error) => {
      clearTimeout(timer);
      throw error;
    }
  );

  return Promise.race([wrappedPromise, timeoutPromise]);
}

export function killProcess(namePattern: string): void {
  if (process.platform === 'win32') {
    execSync(`taskkill /F /FI "WINDOWTITLE eq ${namePattern}" /T 2>nul || ver >nul`, { stdio: 'ignore' });
  } else {
    execSync(`pkill -9 -f "${namePattern}" || true`, { stdio: 'ignore' });
  }
}
