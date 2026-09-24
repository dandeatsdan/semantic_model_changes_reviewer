import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { createStore } from '../server/db.js'
import { compareModels } from '../server/compare.js'

test('persists review decisions and finalises only when resolved',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'smr-db-'))
  const store=createStore(path.join(dir,'test.db'))
  const reference={name:'r',fingerprint:'a',tables:[{name:'T',columns:[],measures:[{table:'T',name:'M',expression:'1',formatString:'',displayFolder:'',description:'',hidden:false}]}]}
  const candidate={name:'c',fingerprint:'b',tables:[{name:'T',columns:[],measures:[{table:'T',name:'M',expression:'2',formatString:'',displayFolder:'',description:'',hidden:false}]}]}
  const comparison=compareModels(reference,candidate)
  let review=store.create({name:'test',reference,candidate,comparison,referenceName:'r.zip',candidateName:'c.zip'})
  assert.equal(review.summary.Unreviewed,1)
  assert.throws(()=>store.finalise(review.id),/Resolve all/)
  review=store.updateChange(review.id,review.changes[0].id,{status:'Approved',comment:'OK'})
  assert.equal(review.summary.Approved,1)
  review=store.finalise(review.id)
  assert.equal(review.status,'Finalised')
  assert.throws(()=>store.updateChange(review.id,review.changes[0].id,{status:'Rejected',comment:''}),/read-only/)
  store.close();fs.rmSync(dir,{recursive:true,force:true})
})


test('deletes a saved review and cascades its changes',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'smr-delete-'))
  const store=createStore(path.join(dir,'test.db'))
  const reference={name:'r',fingerprint:'a',tables:[{name:'T',columns:[],measures:[{table:'T',name:'M',expression:'1',formatString:'',displayFolder:'',description:'',hidden:false}]}]}
  const candidate={name:'c',fingerprint:'b',tables:[{name:'T',columns:[],measures:[{table:'T',name:'M',expression:'2',formatString:'',displayFolder:'',description:'',hidden:false}]}]}
  const comparison=compareModels(reference,candidate)
  const review=store.create({name:'delete me',reference,candidate,comparison,referenceName:'r',candidateName:'c'})

  assert.equal(store.list().length,1)
  assert.equal(store.delete(review.id),true)
  assert.equal(store.get(review.id),null)
  assert.equal(store.list().length,0)
  assert.equal(store.delete(review.id),false)

  store.close()
  fs.rmSync(dir,{recursive:true,force:true})
})
