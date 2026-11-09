// Not at the (app) level: a loading boundary makes pages stream with status 200, so
// /expenses/[id] and /tasks/[id] would lose their real 404 for other households.
export { PageSkeleton as default } from "@/components/page-skeleton";
