// Touch targets: the shared Button, Input, Select, Tabs and filter chip are at least 44px tall
// (Tailwind min-h-11), so every screen built on them is tappable on a phone.

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Button, DateInput, Input, Select } from "@/components/ui/primitives";
import { Tabs } from "@/components/ui/tabs";
import { FilterChips } from "@/components/ui/filter-chips";

describe("44px touch targets on the shared pieces", () => {
  it("Button, in every variant", () => {
    for (const variant of ["primary", "secondary", "danger", "ghost"] as const) {
      expect(renderToStaticMarkup(<Button variant={variant}>Go</Button>)).toContain("min-h-11");
    }
  });

  it("Input, DateInput and Select", () => {
    expect(renderToStaticMarkup(<Input aria-label="a" />)).toContain("min-h-11");
    expect(renderToStaticMarkup(<DateInput aria-label="d" />)).toContain("min-h-11");
    expect(
      renderToStaticMarkup(
        <Select aria-label="s">
          <option>One</option>
        </Select>,
      ),
    ).toContain("min-h-11");
  });

  it("each tab, and the strip scrolls sideways with a fade cue", () => {
    const html = renderToStaticMarkup(
      <Tabs
        items={[
          { id: "a", label: "A", content: null },
          { id: "b", label: "B", content: null },
        ]}
      />,
    );
    expect(html.match(/role="tab"/g)).toHaveLength(2);
    expect(html.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("bg-gradient-to-l");
  });

  it("the + Filter button", () => {
    const html = renderToStaticMarkup(<FilterChips filters={[]} active={{}} onChange={() => undefined} />);
    expect(html).toContain("min-h-11");
  });
});
