// Fixed host command: type-check an isolated example; never execute workspace code.
const fs=require('node:fs'),path=require('node:path');
const [compiler,root,schemaFile,codeFile,sampleFile]=process.argv.slice(2);
const ts=require(compiler);
function fail(message){throw Error(message);}
function inside(base,file){const relative=path.relative(base,file);return !!relative&&relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative);}
function ordinary(file,base){
  if(!inside(base,file))return false;
  let current=base;
  for(const segment of path.relative(base,file).split(path.sep)){
    current=path.join(current,segment);
    if(!fs.existsSync(current)||fs.lstatSync(current).isSymbolicLink())return false;
  }
  return fs.statSync(file).isFile();
}
try {
  if(!root||fs.realpathSync.native(root)!==root||!schemaFile?.endsWith('.ts')||!codeFile||sampleFile!==codeFile+'.f20-sample.ts')fail('Unsupported fixed F20 TypeScript case');
  const sources=[schemaFile,codeFile,sampleFile].map(file=>path.resolve(root,file));
  if(sources.some(file=>!ordinary(file,root)))fail('F20 sources must be ordinary isolated files');
  const options={noEmit:true,strict:true,skipLibCheck:false,allowJs:true,checkJs:true,types:[],
    target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext};
  const host=ts.createCompilerHost(options),compilerRoot=path.dirname(compiler);
  const allowed=file=>ordinary(path.resolve(file),root)||(path.dirname(path.resolve(file))===compilerRoot&&/^lib\..*\.d\.ts$/u.test(path.basename(file))&&ordinary(path.resolve(file),compilerRoot));
  const read=host.readFile.bind(host);host.readFile=file=>allowed(file)?read(file):undefined;host.fileExists=file=>allowed(file);
  host.writeFile=()=>fail('F20 checking cannot emit files');
  const program=ts.createProgram(sources,options,host),checker=program.getTypeChecker(),sample=program.getSourceFile(sources[2]);
  if(!sample||/@ts-(?:ignore|nocheck|expect-error)/u.test(sample.text))fail('F20 sample cannot suppress type errors');
  let contractExample=false;
  function visit(node){
    if(node.kind===ts.SyntaxKind.AnyKeyword||ts.isAsExpression(node)||ts.isTypeAssertionExpression(node)||ts.isNonNullExpression(node)
      ||ts.isSpreadAssignment(node)||ts.isSpreadElement(node))fail('F20 sample cannot bypass its declared contract');
    if(ts.isExpressionNode(node)&&checker.getTypeAtLocation(node).flags&ts.TypeFlags.Any)fail('F20 sample contains an unchecked expression');
    if(ts.isObjectLiteralExpression(node)&&!checker.getContextualType(node))fail('Every F20 example object must have a checked contextual type');
    if(ts.isVariableDeclaration(node)&&node.type&&ts.isTypeReferenceNode(node.type)&&node.initializer&&ts.isObjectLiteralExpression(node.initializer)){
      let symbol=checker.getSymbolAtLocation(node.type.typeName);
      if(symbol?.flags&ts.SymbolFlags.Alias)symbol=checker.getAliasedSymbol(symbol);
      if(symbol?.declarations?.some(declaration=>path.resolve(declaration.getSourceFile().fileName)===sources[0]))contractExample=true;
    }
    ts.forEachChild(node,visit);
  }
  visit(sample);
  if(!contractExample)fail('F20 sample needs an explicit object example typed by the selected contract');
  const diagnostics=ts.getPreEmitDiagnostics(program);
  if(diagnostics.length){process.stderr.write(diagnostics.slice(0,12).map(item=>'TS'+item.code+': '+ts.flattenDiagnosticMessageText(item.messageText,' ')).join('\n'));process.exitCode=1;}
  else process.stdout.write('F20 isolated sample and selected TypeScript contract passed\n');
}catch(error){process.stderr.write(String(error.message)+'\n');process.exitCode=1;}
