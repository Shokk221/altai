import type { Permission, SystemRole } from '@altai/contracts';
import type { OAuth2Namespace } from '@fastify/oauth2';

declare module 'fastify' {
  interface FastifyInstance {
    discordOAuth2: OAuth2Namespace;
  }

  interface FastifyRequest {
    /** requireSession guard'ı doldurur; guard'sız rotalarda tanımsızdır. */
    authSession?: {
      id: string;
      discordUsername: string;
      systemRole: SystemRole;
      permissions: Permission[];
      isBreakGlass: boolean;
    };
  }
}
