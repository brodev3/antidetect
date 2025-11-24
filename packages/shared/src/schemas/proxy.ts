import { z } from 'zod';

/** Shape of a proxy connection definition supported by the services. */
export const ProxySchema = z.object({
  protocol: z.enum(['https', 'socks5']),
  ip: z.string().min(1),
  port: z.number().int().positive(),
  login: z.string().optional(),
  password: z.string().optional(),
});

export type Proxy = z.infer<typeof ProxySchema>;



