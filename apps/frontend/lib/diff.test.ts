import { describe, expect, it } from "vitest";
import { lineDiff } from "./diff";

describe("lineDiff", () => {
  it("đánh dấu dòng thêm/xóa/giữ đúng thứ tự", () => {
    expect(lineDiff("a\nb\nc", "a\nB\nc\nd")).toEqual([
      { op: " ", text: "a" },
      { op: "-", text: "b" },
      { op: "+", text: "B" },
      { op: " ", text: "c" },
      { op: "+", text: "d" },
    ]);
  });
  it("giống hệt thì không có thay đổi; rỗng so với có nội dung thì toàn bộ là thêm", () => {
    expect(lineDiff("x\ny", "x\ny").every((l) => l.op === " ")).toBe(true);
    expect(lineDiff("", "x").filter((l) => l.op === "+")).toEqual([{ op: "+", text: "x" }]);
  });
});
