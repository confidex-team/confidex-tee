import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { ContractService } from '@/lib/services/contract.service';
import { Logger } from '@/lib/utils/logger';

// Initialize the ContractService
const contractService = ContractService.getInstance();
contractService.initialize().catch(console.error);

export async function middleware(request: NextRequest) {
  const startTime = Date.now();
  const url = request.nextUrl;
  const method = request.method;
  const searchParams = Object.fromEntries(url.searchParams.entries());
  
  // Clone the request to read the body
  const requestClone = request.clone();
  let body = {};
  try {
    body = await requestClone.json();
  } catch (e) {
    // Body might not be JSON or might be empty
  }

  const requestLog = {
    method,
    url: url.pathname,
    query: searchParams,
    body,
  };

  try {
    // Process the request
    const response = NextResponse.next();

    // Log successful response
    const endTime = Date.now();
    const duration = `${endTime - startTime}ms`;
    
    Logger.logRequest(requestLog, {
      status: response.status,
      statusText: response.statusText,
    }, { duration });

    return response;
  } catch (error) {
    // Log error response
    const endTime = Date.now();
    const duration = `${endTime - startTime}ms`;
    
    Logger.logError(requestLog, {
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined,
    }, { duration });

    // Return error response
    return NextResponse.json(
      { 
        success: false, 
        message: error instanceof Error ? error.message : 'Internal server error' 
      },
      { status: 500 }
    );
  }
}

export const config = {
  matcher: '/api/:path*',
}; 