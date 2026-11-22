import test from "node:test";
import assert from "node:assert/strict";
import { wallFromReference } from "./walls.js";

test("axis preserves the line command's exact length and angle", () => {
  const w = wallFromReference("w", {x:10,y:20}, {x:3010,y:4020}, {width:200});
  assert.equal(Math.hypot(w.x2-w.x1,w.y2-w.y1),5000);
  assert.deepEqual([w.x1,w.y1,w.x2,w.y2],[10,20,3010,4020]);
});
test("face reference and flip put the same drawn line on opposite wall faces", () => {
  const a={x:0,y:0}, b={x:3000,y:0};
  assert.equal(wallFromReference("w",a,b,{width:200,location:"left"}).y1,-100);
  assert.equal(wallFromReference("w",a,b,{width:200,location:"left",flipped:true}).y1,100);
  assert.equal(wallFromReference("w",a,b,{width:200,location:"right"}).y1,100);
});
test("offset is perpendicular for vertical walls and does not change length", () => {
  const w=wallFromReference("w",{x:0,y:0},{x:0,y:1200},{width:200,offset:250});
  assert.deepEqual([w.x1,w.x2,w.y1,w.y2],[-250,-250,0,1200]);
});
test("rejects a zero or invalid segment and limits wall thickness", () => {
  assert.equal(wallFromReference("w",{x:0,y:0},{x:0,y:0}),null);
  assert.equal(wallFromReference("w",{x:0,y:0},{x:NaN,y:0}),null);
  assert.equal(wallFromReference("w",{x:0,y:0},{x:10,y:0},{width:-3}).width,20);
});
