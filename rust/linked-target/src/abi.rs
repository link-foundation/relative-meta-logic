// Generated from the executable Link target model; do not edit.
use serde_json::Value;
const MAX_BYTES:usize=16777216;
const ALIGN:usize=4;
const MAX_DEPTH:usize=256;
const MAX_NODES:usize=1000000;
const MAX_TEXT:usize=8388608;
const NONEMPTY:bool=true;
const MAGIC:u32=1380797489;
const TEXT:u32=1;
const LIST:u32=2;
const FM:usize=0;
const FR:usize=4;
const FE:usize=8;
const CT:usize=0;
const CP:usize=4;
const CL:usize=8;
fn put(memory:&mut [u8],at:usize,value:usize)->Result<(),String>{let value=u32::try_from(value).map_err(|_|"target word overflow")?;memory.get_mut(at..at+4).ok_or("target word bounds")?.copy_from_slice(&value.to_le_bytes());Ok(())}
fn word(memory:&[u8],at:usize)->Result<usize,String>{let data:[u8;4]=memory.get(at..at.checked_add(4).ok_or("target address overflow")?).ok_or("target word bounds")?.try_into().map_err(|_|"target word width")?;Ok(u32::from_le_bytes(data) as usize)}
fn allocate(memory:&mut Vec<u8>,count:usize)->Result<usize,String>{let at=memory.len().checked_add(ALIGN-1).ok_or("target address overflow")?/ALIGN*ALIGN;let end=at.checked_add(count).ok_or("target address overflow")?;if end>MAX_BYTES{return Err("target memory limit".into())}memory.resize(end,0);Ok(at)}
fn encode_value(value:&Value,depth:usize,memory:&mut Vec<u8>,nodes:&mut usize,text:&mut usize)->Result<usize,String>{
 if depth>MAX_DEPTH||*nodes>=MAX_NODES{return Err("target term budget".into())}*nodes+=1;
 let at=allocate(memory,12)?;
 match value{
  Value::String(s)=>{if NONEMPTY&&s.is_empty(){return Err("target empty text".into())}*text=text.checked_add(s.len()).ok_or("target text overflow")?;if *text>MAX_TEXT{return Err("target text limit".into())}let payload=allocate(memory,s.len())?;memory[payload..payload+s.len()].copy_from_slice(s.as_bytes());put(memory,at+CT,TEXT as usize)?;put(memory,at+CP,payload)?;put(memory,at+CL,s.len())?;},
  Value::Array(values)=>{let payload=allocate(memory,values.len().checked_mul(4).ok_or("target size overflow")?)?;put(memory,at+CT,LIST as usize)?;put(memory,at+CP,payload)?;put(memory,at+CL,values.len())?;for(i,value)in values.iter().enumerate(){let child=encode_value(value,depth+1,memory,nodes,text)?;put(memory,payload+i*4,child)?;}},
  _=>return Err("target requires terms".into())
 }Ok(at)
}
pub fn encode_frame(value:&Value)->Result<Vec<u8>,String>{let mut memory=vec![0;12];let root=encode_value(value,1,&mut memory,&mut 0,&mut 0)?;let end=memory.len();put(&mut memory,FM,MAGIC as usize)?;put(&mut memory,FR,root)?;put(&mut memory,FE,end)?;Ok(memory)}
fn span(memory:&[u8],at:usize,len:usize)->Result<(),String>{if at<12||at.checked_add(len).ok_or("target address overflow")?>memory.len(){return Err("target address bounds".into())}Ok(())}
fn decode_value(memory:&[u8],at:usize,depth:usize,nodes:&mut usize,text:&mut usize,seen:&mut std::collections::HashSet<usize>)->Result<Value,String>{
 span(memory,at,12)?;if at%ALIGN!=0||!seen.insert(at)||depth>MAX_DEPTH||*nodes>=MAX_NODES{return Err("target term budget or alias".into())}*nodes+=1;
 let tag=word(memory,at+CT)? as u32;let payload=word(memory,at+CP)?;let len=word(memory,at+CL)?;
 if tag==TEXT{span(memory,payload,len)?;*text=text.checked_add(len).ok_or("target text overflow")?;if *text>MAX_TEXT{return Err("target text limit".into())}let s=std::str::from_utf8(&memory[payload..payload+len]).map_err(|_|"target invalid UTF-8")?;if NONEMPTY&&s.is_empty(){return Err("target empty text".into())}return Ok(Value::String(s.into()))}
 if tag!=LIST{return Err("target unknown tag".into())}span(memory,payload,len.checked_mul(4).ok_or("target size overflow")?)?;if len>MAX_NODES{return Err("target list limit".into())}let mut result=Vec::new();for i in 0..len{result.push(decode_value(memory,word(memory,payload+i*4)?,depth+1,nodes,text,seen)?)}Ok(Value::Array(result))
}
pub fn decode_frame(memory:&[u8])->Result<Value,String>{if memory.len()<24||memory.len()>MAX_BYTES{return Err("target frame size".into())}if word(memory,FM)?!=MAGIC as usize||word(memory,FE)?!=memory.len(){return Err("target frame header".into())}let value=decode_value(memory,word(memory,FR)?,1,&mut 0,&mut 0,&mut std::collections::HashSet::new())?;if encode_frame(&value)?!=memory{return Err("target noncanonical frame".into())}Ok(value)}
fn array(value:Value)->Result<Vec<Value>,String>{match value{Value::Array(v)=>Ok(v),_=>Err("target expected list".into())}}
fn boolean(value:Value)->Result<bool,String>{value.as_bool().ok_or_else(||"target expected boolean".into())}
fn head(value:Value)->Result<Value,String>{array(value)?.into_iter().next().ok_or_else(||"target empty head".into())}
fn tail(value:Value)->Result<Value,String>{let mut values=array(value)?;if values.is_empty(){return Err("target empty tail".into())}values.remove(0);Ok(Value::Array(values))}
fn program_accepted(args:&[Value],fuel:&mut usize,depth:&mut usize)->Result<Value,String>{if args.len()!=1||*fuel==0||*depth>=MAX_DEPTH{return Err("target invocation/fuel/depth".into())}*fuel-=1;*depth+=1;let result=(if boolean(Value::Bool(args[0].clone().is_string()))? {Value::Bool(Value::String(String::from("true"))==Value::String(String::from("false")))} else {(if boolean(Value::Bool(array(args[0].clone())?.is_empty()))? {Value::Bool(Value::String(String::from("true"))==Value::String(String::from("false")))} else {Value::Bool(head(args[0].clone())?==Value::String(String::from("proof-accepted")))})});*depth-=1;Ok(result)}
fn program_program(args:&[Value],fuel:&mut usize,depth:&mut usize)->Result<Value,String>{if args.len()!=0||*fuel==0||*depth>=MAX_DEPTH{return Err("target invocation/fuel/depth".into())}*fuel-=1;*depth+=1;let result=Value::String(String::from("linked-proof-verifier"));*depth-=1;Ok(result)}
fn program_quote(args:&[Value],fuel:&mut usize,depth:&mut usize)->Result<Value,String>{if args.len()!=1||*fuel==0||*depth>=MAX_DEPTH{return Err("target invocation/fuel/depth".into())}*fuel-=1;*depth+=1;let result=(if boolean(Value::Bool(args[0].clone().is_string()))? {Value::Array(vec![Value::String(String::from("atom")),args[0].clone()])} else {(if boolean(Value::Bool(array(args[0].clone())?.is_empty()))? {Value::Array(vec![Value::String(String::from("list-end"))])} else {Value::Array(vec![Value::String(String::from("pair")),program_quote(&[head(args[0].clone())?],fuel,depth)?,program_quote(&[tail(args[0].clone())?],fuel,depth)?])})});*depth-=1;Ok(result)}
fn program_receipt(args:&[Value],fuel:&mut usize,depth:&mut usize)->Result<Value,String>{if args.len()!=5||*fuel==0||*depth>=MAX_DEPTH{return Err("target invocation/fuel/depth".into())}*fuel-=1;*depth+=1;let result=Value::Array(vec![Value::String(String::from("rml-linked-proof-replay/v1")),args[0].clone(),(if boolean(program_accepted(&[args[2].clone()],fuel,depth)?)? {Value::String(String::from("true"))} else {Value::String(String::from("false"))}),args[1].clone(),args[2].clone(),args[3].clone(),args[4].clone()]);*depth-=1;Ok(result)}
fn program_request(args:&[Value],fuel:&mut usize,depth:&mut usize)->Result<Value,String>{if args.len()!=3||*fuel==0||*depth>=MAX_DEPTH{return Err("target invocation/fuel/depth".into())}*fuel-=1;*depth+=1;let result=Value::Array(vec![Value::String(String::from("verify-linked-proof")),program_quote(&[args[0].clone()],fuel,depth)?,program_quote(&[args[1].clone()],fuel,depth)?,program_quote(&[args[2].clone()],fuel,depth)?]);*depth-=1;Ok(result)}
pub fn execute_program(name:&str,args:&[Value])->Result<Value,String>{let mut fuel=1000000;let mut depth=0;match name{"accepted"=>program_accepted(args,&mut fuel,&mut depth),"program"=>program_program(args,&mut fuel,&mut depth),"quote"=>program_quote(args,&mut fuel,&mut depth),"receipt"=>program_receipt(args,&mut fuel,&mut depth),"request"=>program_request(args,&mut fuel,&mut depth),_=>Err("unknown target program".into())}}
