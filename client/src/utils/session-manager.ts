/**
 * Session Manager - Ensures consistent session cookie transmission
 */

interface SessionInfo {
  id: string;
  user: any;
  established: boolean;
}

class SessionManager {
  private sessionInfo: SessionInfo | null = null;
  private sessionPromise: Promise<SessionInfo> | null = null;

  async establishSession(): Promise<SessionInfo> {
    if (this.sessionPromise) {
      return this.sessionPromise;
    }

    // First check if we already have a valid session using the user endpoint
    try {
      const response = await fetch('/api/user', {
        method: 'GET',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const user = await response.json();
        console.log('🔍 Session check result:', { authenticated: true, user });
        
        if (user && user.email) {
          console.log('✅ Existing session verified for:', user.email);
          
          this.sessionInfo = {
            id: 'existing',
            user: user,
            established: true
          };
          
          return this.sessionInfo;
        }
      }
    } catch (error) {
      console.log('⚠️ Session verification failed, creating new session');
    }

    this.sessionPromise = this.doEstablishSession();
    return this.sessionPromise;
  }

  private async doEstablishSession(): Promise<SessionInfo> {
    try {
      console.log('🔍 Establishing session...');
      
      const response = await fetch('/api/establish-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        credentials: 'include',
        body: JSON.stringify({
          email: 'gailm@macleodglba.com.au',
          phone: '+61424835189'
        })
      });

      if (response.ok) {
        const data = await response.json();
        console.log('✅ Session establishment response:', data);
        
        // Extract session ID from response
        const sessionId = data.sessionId;
        if (sessionId) {
          console.log('📋 Session ID received:', sessionId);
          
          // Store session information in localStorage for fallback
          localStorage.setItem('aiq_session_id', sessionId);
          localStorage.setItem('aiq_user_id', data.user.id.toString());
          localStorage.setItem('aiq_user_email', data.user.email);
          
          // Check if cookies are being set by examining the response headers
          const cookies = response.headers.get('Set-Cookie');
          if (cookies) {
            console.log('🍪 Set-Cookie headers found:', cookies);
            localStorage.setItem('aiq_has_cookies', 'true');
          } else {
            console.log('⚠️ No Set-Cookie headers found in response');
            localStorage.setItem('aiq_has_cookies', 'false');
          }
          
          console.log('🔧 Session information stored in localStorage as fallback');
        }
        
        this.sessionInfo = {
          id: sessionId || 'established',
          user: data.user,
          established: true
        };
        
        console.log('✅ Session established:', data.user?.email || 'User authenticated');
        console.log('User ID:', data.user?.id);
        console.log('Session ID:', sessionId);
        
        // Store user info
        if (data.user) {
          sessionStorage.setItem('currentUser', JSON.stringify({
            id: data.user.id,
            email: data.user.email,
            phone: data.user.phone
          }));
        }
        
        // Add a delay to ensure cookie is set by the browser before returning
        await new Promise(resolve => setTimeout(resolve, 500));
        
        return this.sessionInfo;
      } else {
        console.error('Session establishment failed with status:', response.status);
        const errorData = await response.json();
        throw new Error(errorData.message || 'Session establishment failed');
      }
    } catch (error) {
      console.error('Session establishment error:', error);
      throw error;
    }
  }

  getSessionInfo(): SessionInfo | null {
    return this.sessionInfo;
  }

  async makeAuthenticatedRequest(url: string, options: RequestInit = {}): Promise<Response> {
    console.log(`🔍 Making authenticated request to: ${url}`);
    
    // Check if we have localStorage fallback session information
    const storedSessionId = localStorage.getItem('aiq_session_id');
    const storedUserId = localStorage.getItem('aiq_user_id');
    const storedUserEmail = localStorage.getItem('aiq_user_email');
    
    // Prepare headers with fallback session information
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      ...options.headers,
    };
    
    // Create URL with query parameters for fallback authentication
    let requestUrl = url;
    if (storedSessionId && storedUserId && storedUserEmail) {
      const urlObj = new URL(url, window.location.origin);
      urlObj.searchParams.set('fallback_session_id', storedSessionId);
      urlObj.searchParams.set('fallback_user_id', storedUserId);
      urlObj.searchParams.set('fallback_user_email', storedUserEmail);
      requestUrl = urlObj.toString();
      console.log('🔑 Adding fallback auth via query params:', { storedSessionId, storedUserId, storedUserEmail });
      console.log('🔑 Final request URL:', requestUrl);
    }
    
    // Use browser's built-in cookie mechanism with fallback query params
    const requestOptions: RequestInit = {
      ...options,
      credentials: 'include',
      headers,
    };

    const response = await fetch(requestUrl, requestOptions);

    // If we get a 401, try to re-establish session once
    if (response.status === 401 && !options.headers?.['X-Retry-Session']) {
      console.log('🔄 Session expired, re-establishing...');
      this.sessionInfo = null;
      this.sessionPromise = null;
      
      await this.establishSession();
      
      // Refresh the stored session information
      const newSessionId = localStorage.getItem('aiq_session_id');
      const newUserId = localStorage.getItem('aiq_user_id');
      const newUserEmail = localStorage.getItem('aiq_user_email');
      
      const retryHeaders: HeadersInit = {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-Retry-Session': 'true',
        ...options.headers,
      };
      
      // Create retry URL with query parameters
      let retryUrl = url;
      if (newSessionId && newUserId && newUserEmail) {
        const retryUrlObj = new URL(url, window.location.origin);
        retryUrlObj.searchParams.set('fallback_session_id', newSessionId);
        retryUrlObj.searchParams.set('fallback_user_id', newUserId);
        retryUrlObj.searchParams.set('fallback_user_email', newUserEmail);
        retryUrl = retryUrlObj.toString();
      }
      
      return fetch(retryUrl, {
        ...requestOptions,
        headers: retryHeaders,
      });
    }

    return response;
  }

  private getSessionCookie(): string | null {
    // First try to get session cookie from sessionStorage (manual handling)
    const sessionCookie = sessionStorage.getItem('sessionCookie');
    if (sessionCookie) {
      console.log('🔑 Using stored session cookie:', sessionCookie.substring(0, 50) + '...');
      return sessionCookie;
    }
    
    // Fallback: Extract session cookie from document.cookie
    const cookies = document.cookie.split(';');
    for (const cookie of cookies) {
      const [name, value] = cookie.trim().split('=');
      if (name === 'theagencyiq.session') {
        console.log('🍪 Found session cookie:', `${name}=${value.substring(0, 50)}...`);
        return `${name}=${value}`;
      }
    }
    
    // Debug: log all available cookies
    console.log('🍪 Available cookies:', document.cookie);
    console.log('🔑 Session ID in storage:', sessionStorage.getItem('sessionId'));
    return null;
  }

  clearSession() {
    this.sessionInfo = null;
    this.sessionPromise = null;
    sessionStorage.removeItem('sessionId');
    sessionStorage.removeItem('sessionCookie');
    sessionStorage.removeItem('currentUser');
    
    // Clear all session-related cookies
    document.cookie = 'theagencyiq.session=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    document.cookie = 'theagencyiq.session.unsigned=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    
    // Clear localStorage session data
    localStorage.removeItem('aiq_session_cookie');
    localStorage.removeItem('aiq_session_cookie_unsigned');
  }
  
  /**
   * Generate a mock signature for session cookies (development only)
   */
  private generateSignature(sessionId: string): string {
    // Simple hash for development - matches server-side signing
    let hash = 0;
    for (let i = 0; i < sessionId.length; i++) {
      const char = sessionId.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(36);
  }
}

export const sessionManager = new SessionManager();