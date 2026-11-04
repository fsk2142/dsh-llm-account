import { it, expect } from "vitest";
import { writeModelRules } from "../../src/vendors/assembly";
import { assignModelsToAccount } from "../../src/core/accounts";
import type { ModelRule, SettingsPort } from "../../src/core/adapter";

function store() {
 let value: Record<string, unknown> = {modelAccountRules: []}; let revision=0;
 const port: SettingsPort = {
  async describe() { return {revision, value: structuredClone(value)}; },
  async mutate(_ns, ops, expected) {
   if(expected!==revision) throw Object.assign(new Error("conflict"),{code:"SETTINGS_CONFLICT"});
   for(const op of ops) {if(op.op==="set")value[op.path[0]!]=structuredClone(op.value);else delete value[op.path[0]!];}
   revision++; return {revision,value:structuredClone(value)};
  }
 };
 return {port, value:()=>value};
}
it("concurrent account choices survive a revision conflict without overwriting the other account",async()=>{
 const s=store();
 const select=(ref:string,models:string[])=>writeModelRules(s.port,"vendor",current=>assignModelsToAccount((current.modelAccountRules??[]) as ModelRule[],ref,models));
 await Promise.all([select("A",["m1"]),select("B",["m2"])]);
 const value=s.value();
 expect((value.modelAccountRules as ModelRule[]).sort((a,b)=>a.account.localeCompare(b.account))).toEqual([{account:"A",models:["m1"]},{account:"B",models:["m2"]}]);
 expect((value.visibleModels as string[]).sort()).toEqual(["m1","m2"]);
 expect(value.modelVisibility).toEqual({m1:true,m2:true});
});
it("removing one account assignment preserves a concurrent addition to another account",async()=>{
 const s=store();
 await writeModelRules(s.port,"vendor",[{account:"A",models:["old"]}]);
 const select=(ref:string,models:string[])=>writeModelRules(s.port,"vendor",current=>assignModelsToAccount((current.modelAccountRules??[]) as ModelRule[],ref,models));
 await Promise.all([select("A",[]),select("B",["new"])]);
 expect(s.value().modelAccountRules).toEqual([{account:"B",models:["new"]}]);
 expect(s.value().visibleModels).toEqual(["new"]);
});
