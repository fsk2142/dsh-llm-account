import {it,expect} from "vitest";
import {createCommandCodeAdapter} from "../../src/vendors/commandcode/adapter";
import {createOpencodeAdapter} from "../../src/vendors/opencode/adapter";
import {createOpenDesignAdapter} from "../../src/vendors/opendesign/adapter";
import {RotationEngine} from "../../src/core/switching/rotation";
import type {StreamChunk} from "@deepseek-ai/dsh-llm";
const bytes=new Uint8Array([111,108,100]);
function reply(anthropic:boolean) {
 const frames=anthropic ? [
  'event: message_start\ndata: {"type":"message_start","message":{"id":"m1","role":"assistant","model":"m","content":[],"usage":{"input_tokens":1,"output_tokens":0}}}\n\n',
  'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
  'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"SUMMARY_OK"}}\n\n',
  'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
  'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n',
  'event: message_stop\ndata: {"type":"message_stop"}\n\n'
 ] : ['data: {"choices":[{"index":0,"delta":{"content":"SUMMARY_OK"}}]}\n\n','data: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n','data: [DONE]\n\n'];
 return new Response(frames.join(''),{headers:{"content-type":"text/event-stream"}});
}
for(const vendor of ["commandcode","opencode","opendesign"] as const) for(const purpose of [undefined,"compaction","session-title"] as const) {
 it(`${vendor}: ${purpose??"chat"} with assistant history image can generate text without reading historical bytes`,async()=>{
  const requests:unknown[]=[];let reads=0;
  const fetchImpl=(async(input:unknown,init?:RequestInit)=>{
   const url=String(input);
   if(url.includes("models.dev"))return Response.json({"opencode-go":{models:{m:{reasoning:false,modalities:{input:["text"]},provider:{npm:"@ai-sdk/anthropic"}}}}});
   if(url.endsWith("/models"))return Response.json({data:[{id:"m",context_length:128000,max_output_tokens:8192}]});
   if(typeof init?.body==="string")requests.push(JSON.parse(init.body));
   return reply(vendor==="opencode");
  }) as typeof fetch;
  const create=vendor==="commandcode"?createCommandCodeAdapter:vendor==="opencode"?createOpencodeAdapter:createOpenDesignAdapter;
  const route=create({config:()=>({apiBase:vendor==="opencode"?"https://opencode.ai/zen/go/v1":"https://example.test/v1"}),rotation:new RotationEngine({order:["A"],pinned:"A",rules:[]}),accounts:{list:async()=>[{ref:"A"}]} as never,quota:{snapshot:async()=>({windows:[],failures:[]})},resolveStored:async()=>"fake-key",resolveImage:async(ref)=>{reads++;return{attachmentId:ref.attachmentId,data:bytes,mediaType:"image/png"};},fetchImpl});
  const chunks:StreamChunk[]=[];
  for await(const chunk of route.stream({provider:vendor,model:"m",purpose,messages:[{role:"user",content:[{type:"text",text:"question"}]},{role:"assistant",content:[{type:"text",text:"answer-before-image"},{type:"image",attachment:{attachmentId:"old-history",mediaType:"image/png",bytes:3,width:1,height:1}}]},{role:"user",content:[{type:"text",text:"summarize"}]}]} as never))chunks.push(chunk);
  expect(requests).toHaveLength(1);const body=JSON.stringify(requests[0]);
  expect(body).toContain("answer-before-image");expect(body).toContain("历史");
  // **不再发送内部 attachmentId**（2026-11-05 外部审查 F10）：占位只需要说「这里原本有图」。
  // 上面已有 `expect(body).not.toContain("old-history")` 的相邻断言，这里明确写下来。
  expect(body).not.toContain("old-history");
  expect(body).not.toContain(Buffer.from(bytes).toString("base64"));expect(reads).toBe(0);
  expect(chunks.some(c=>c.type==="text-delta"&&c.text==="SUMMARY_OK")).toBe(true);expect(chunks.at(-1)).toMatchObject({type:"finish",reason:{kind:"stop"}});
 });
}
