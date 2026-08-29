export class FlomoError extends Error {
  override readonly name: string = 'FlomoError';
}

export class FlomoAuthError extends FlomoError {
  override readonly name = 'FlomoAuthError';
}

export class FlomoArgumentError extends FlomoError {
  override readonly name = 'FlomoArgumentError';
}

export class FlomoApiError extends FlomoError {
  override readonly name = 'FlomoApiError';
}

export class FlomoEmptyError extends FlomoError {
  override readonly name = 'FlomoEmptyError';
}

export class FlomoTimeoutError extends FlomoError {
  override readonly name = 'FlomoTimeoutError';
}
