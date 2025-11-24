import { z } from 'zod';
import { ProxySchema } from '../schemas/proxy';

/**
 * Accepts a colon-delimited proxy string and normalizes it to the structured proxy schema.
 */
export const ProxyStringSchema = z
  .string()
  .transform((value) => {
    const [ip, portStr, login, password] = value.split(':');
    return { ip, port: Number(portStr), login, password };
  })
  .pipe(
    ProxySchema.pick({ protocol: true }).extend({
      ip: ProxySchema.shape.ip,
      port: ProxySchema.shape.port,
      login: ProxySchema.shape.login,
      password: ProxySchema.shape.password,
    }),
  );



