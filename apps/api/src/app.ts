import { healthResponseSchema } from "@antidetect/contracts";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";
import Fastify, { type FastifyInstance } from "fastify";

export function buildApp(): FastifyInstance {
  const app = Fastify({ logger: false });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.withTypeProvider<ZodTypeProvider>().get(
    "/health",
    {
      schema: {
        response: {
          200: healthResponseSchema,
        },
      },
    },
    async () => ({ status: "ok" as const }),
  );

  return app;
}
