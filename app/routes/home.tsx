import type { Route } from './+types/home';

export function meta(_args: Route.MetaArgs) {
  return [{ title: "Danny's Dockers" }];
}

export default function Home() {
  return (
    <main>
      <h1>Danny&apos;s Dockers</h1>
      <p>Placeholder. The Explore page lands in a later task.</p>
    </main>
  );
}
