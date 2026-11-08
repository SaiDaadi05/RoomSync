#!/bin/sh
# Build used by Vercel (npm runs the "vercel-build" script instead of "build" when it exists).
# Applies pending migrations before building. Migrations use the direct (unpooled) connection
# when one is provided, because Prisma's migration lock doesn't work through a pooler.
set -e
npx prisma generate
DATABASE_URL="${DATABASE_URL_UNPOOLED:-${POSTGRES_URL_NON_POOLING:-$DATABASE_URL}}" npx prisma migrate deploy
npx next build
