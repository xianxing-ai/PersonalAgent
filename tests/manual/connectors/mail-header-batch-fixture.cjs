// Public synthetic mail content only. No recipient, transport, account or sending API.
const {randomUUID}=require('node:crypto');
const assert=require('node:assert/strict');
const labels=['meeting','work','subscription','transaction','personal','other'];
const subjects={
  meeting:['Team meeting invitation','Appointment moved to Thursday','Planning meeting agenda','Calendar invitation for a workshop',
    'Meeting time changed to 14:00','Weekly meeting room update','Project meeting postponed','Appointment confirmation',
    'Design workshop calendar event','Meeting invitation for Friday','Public seminar appointment','Agenda coordination for Tuesday',
    'Review meeting rescheduled','Calendar event location update','Workshop meeting reminder','Planning session moved to Monday',
    'Team appointment cancellation','Meeting agenda for next week','Calendar invitation update','Appointment moved to next month'],
  work:['Engineering code review discussion','Project technical design notes','Pull request review summary','Development task progress',
    'Software test results discussion','Project deliverable status','Engineering design document','Build pipeline technical notes',
    'Bug investigation progress','Repository code review notes','Technical implementation proposal','Development milestone report',
    'API design feedback','Testing task summary','Project documentation update','Engineering release checklist discussion',
    'Software architecture notes','Code quality discussion','Development work item status','Project delivery report'],
  subscription:['Technology newsletter edition','Weekly science digest','Subscribed product update','Monthly astronomy news',
    'Open source newsletter','Weekly technology news digest','Museum newsletter edition','Subscribed gardening digest',
    'Monthly public library news','Product release newsletter','Weekly mathematics digest','Science magazine update',
    'Subscribed transport news','Monthly photography digest','Technology trend newsletter','Public education newsletter',
    'Weekly environment digest','Subscribed space news','Monthly digital magazine','Public research newsletter'],
  transaction:['Fictional order receipt','Sample invoice number','Fictional parcel delivery notice','Sample payment receipt',
    'Fictional purchase confirmation','Sample billing statement','Fictional order shipment notice','Sample refund receipt',
    'Fictional delivery tracking update','Sample subscription payment receipt','Fictional order cancellation receipt','Sample invoice payment confirmation',
    'Fictional shop order confirmation','Sample electronic receipt','Fictional parcel arrival notice','Sample transaction statement',
    'Fictional purchase refund notice','Sample monthly invoice','Fictional order dispatch notice','Sample billing receipt'],
  personal:['A friendly note about the weekend','Family picnic memories','A greeting from a fictional friend','Photos from a pretend family outing',
    'A personal thank you note','A friendly holiday greeting','Family garden conversation','A fictional birthday greeting',
    'Catching up after a long time','A personal note about a new hobby','A greeting from an old friend','Family cooking conversation',
    'A friendly note about a book','A personal travel memory','A fictional family celebration','A friendly congratulations note',
    'A personal postcard greeting','Family pet conversation','A fictional reunion memory','A friendly seasonal greeting'],
  other:['Untitled fragment','A miscellaneous note','Several unrelated words','An unclear short fragment',
    'A vague message','Unspecified subject','Assorted fragments','No clear topic',
    'A small miscellaneous memo','Uncategorized words','An incomplete phrase','A vague observation',
    'A fragment without context','Several disconnected ideas','An unspecified update','A general miscellaneous item',
    'An unclear remark','A short unstructured note','An unknown topic','An ambiguous fragment'],
};
function createManifest(cohortId='pa-header-batch-'+randomUUID()){
  assert.match(cohortId,/^pa-header-batch-[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  return {version:1,cohortId,total:120,perLabel:20,pageSize:100,
    cases:Array.from({length:120},(_,index)=>{
      const expectedLabel=labels[index%6],variant=Math.floor(index/6),caseIndex=index+1;
      const subject=`[${cohortId}] ${String(caseIndex).padStart(3,'0')} ${subjects[expectedLabel][variant]}`;
      return {caseIndex,expectedLabel,subject,
        body:`Public synthetic sample ${String(caseIndex).padStart(3,'0')}. ${subjects[expectedLabel][variant]}. All events and transactions are fictional.`};
    })};
}
function validateManifest(value){
  assert.deepEqual(value,createManifest(value?.cohortId),'Only the canonical public 120-case fixture is accepted');
  return value;
}
module.exports={labels,createManifest,validateManifest};
if(require.main===module){
  if(process.argv.length!==2)throw Error('No sending or recipient arguments are accepted');
  console.log(JSON.stringify(createManifest(),null,2));
}
