import { NextResponse, type NextRequest } from 'next/server';
import { ApiError, privateHeaders } from './server/http/api-error';
import { localOrigin } from './server/http/guard';

export function proxy(request: NextRequest) {
  try {
    localOrigin(request);
    return NextResponse.next();
  } catch (error) {
    const failure = error instanceof ApiError ? error : new ApiError('forbidden_host', 403, 'Используйте локальный адрес приложения.');
    return NextResponse.json({ success: false, error: { code: failure.code, message: failure.message } }, {
      status: failure.status, headers: privateHeaders,
    });
  }
}

export const config = { matcher: '/:path*' };
