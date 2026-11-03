import type { Config } from '@react-router/dev/config';

export default {
  ssr: true,
  appDirectory: 'app',
  future: {
    // Route middleware: the root's `securityHeadersMiddleware` sets the security
    // headers on resource route (`/api/*`) and `.data` responses.
    v8_middleware: true,
  },
} satisfies Config;
