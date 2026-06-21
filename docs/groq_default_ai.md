# VIBA Default AI

VIBA should use the platform-level Groq provider by default when the deployment has the Groq key configured.

Users do not need to provide Groq for ordinary use.

Users may still add their own paid Groq key later if they want their own quota to be used.

Priority:

1. User-saved Groq key
2. Platform Groq key
3. Other enabled providers
4. Provider fallback pool
