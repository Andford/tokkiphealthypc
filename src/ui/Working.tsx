// While something is being looked at: Tokkip searching, his shape spinning.

import { Tokkip } from "./Tokkip";

export function Working({ text }: { text: string }) {
  return (
    <section class="card working" aria-live="polite">
      <Tokkip size={64} state="searching" label={text} />
      <p>{text}</p>
    </section>
  );
}
