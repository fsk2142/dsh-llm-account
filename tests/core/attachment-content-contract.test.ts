import {describe,it,expect} from "vitest";
import {fileBlockText,assertProjectableContent,wantedImagesOf,assistantImageText} from "../../src/core/image-projection";
const image={type:"image",attachment:{attachmentId:"img-1"}} as const;
const file={type:"file",attachment:{attachmentId:"sha256:"+"a".repeat(64),name:"manual.pdf",bytes:123}} as const;
describe("non-text content contracts",()=>{
 it("keeps a file handle and explicitly states unreadable path instead of pretending to read bytes",()=>{
  const text=fileBlockText(file as never);expect(text).toContain("manual.pdf");expect(text).toContain("123 bytes");expect(text).toContain("cannot access a readable path");expect(text).toContain("do not claim to have read");
 });
 it.each([null,{}, {attachmentId:"x",name:"x"},{attachmentId:"x",name:"x",bytes:-1}])("rejects malformed file reference %j",attachment=>{
  expect(()=>fileBlockText({type:"file",attachment} as never)).toThrowError(expect.objectContaining({code:"UNSUPPORTED_CONTENT"}));
 });
 it.each(["system","developer"])("rejects %s images before collecting bytes",role=>{
  const messages=[{role,content:[image]}];
  expect(()=>assertProjectableContent(messages as never)).toThrowError(expect.objectContaining({code:"UNSUPPORTED_CONTENT"}));
  expect(()=>wantedImagesOf(messages as never)).toThrowError(expect.objectContaining({code:"UNSUPPORTED_CONTENT"}));
 });
 it("collects tool and user images once while leaving files as handles",()=>{
  const messages=[{role:"user",content:[image,file]},{role:"tool",content:[image]}];
  expect([...wantedImagesOf(messages as never).keys()]).toEqual(["img-1"]);
 });
 it("does not re-read offloaded tool images",()=>{
  expect(wantedImagesOf([{role:"tool",content:[{...image,offloaded:true}]}] as never).size).toBe(0);
 });
});

it("assistant history preserves an explicit marker without attachment reads",()=>{
 const messages=[{role:"assistant",content:[image]}];expect(()=>assertProjectableContent(messages as never)).not.toThrow();expect(wantedImagesOf(messages as never).size).toBe(0);expect(assistantImageText(image as never)).toContain("img-1");expect(assistantImageText(image as never)).toContain("历史");
});
