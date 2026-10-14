'use strict';

// This module runs on the server only. No completed model formulas are embedded
// in the student HTML. All coordinates originate in the existing SVG pictures.
const fs = require('node:fs');
const path = require('node:path');
const KIND = { circle: '원', arc: '원호', line: '선분', point: '점' };
const EPSILON = 1e-8;

function numberText(value) {
  if (!Number.isFinite(value)) throw new Error('Non-finite geometry coordinate');
  const rounded = Math.abs(value) < EPSILON ? 0 : Number(value.toPrecision(10));
  return String(rounded);
}

function rationalText(value) {
  if (Math.abs(value) < EPSILON) return '0';
  for (let denominator = 1; denominator <= 1000; denominator += 1) {
    const numerator = Math.round(value * denominator);
    if (Math.abs(numerator / denominator - value) < EPSILON) {
      return denominator === 1 ? String(numerator) : `${numerator}/${denominator}`;
    }
  }
  return numberText(value);
}

function difference(variable, center) {
  if (Math.abs(center) < EPSILON) return variable;
  return `(${variable}${center < 0 ? '+' : '-'}${numberText(Math.abs(center))})`;
}

function circleEquation(cx, cy, radius) {
  return `${difference('x', cx)}^2+${difference('y', cy)}^2=${numberText(radius * radius)}`;
}

function lineEquation(x1, y1, x2, y2) {
  [x1, y1, x2, y2].forEach(numberText);
  if (Math.abs(x2-x1) < EPSILON && Math.abs(y2-y1) < EPSILON) {
    return `(${numberText(x1)},${numberText(y1)})`;
  }
  if (Math.abs(x2-x1) < EPSILON) {
    return `x=${numberText(x1)}{${numberText(Math.min(y1,y2))}<=y<=${numberText(Math.max(y1,y2))}}`;
  }
  const slope = (y2-y1)/(x2-x1);
  const intercept = y1-slope*x1;
  let right;
  if (Math.abs(slope) < EPSILON) {
    right = rationalText(intercept);
  } else {
    const coefficient = Math.abs(Math.abs(slope)-1) < EPSILON ? '' : rationalText(Math.abs(slope));
    right = `${slope < 0 ? '-' : ''}${coefficient.includes('/')?'('+coefficient+')':coefficient}x`;
    if (Math.abs(intercept) >= EPSILON) right += `${intercept < 0 ? '-' : '+'}${rationalText(Math.abs(intercept))}`;
  }
  return `y=${right}{${numberText(Math.min(x1,x2))}<=x<=${numberText(Math.max(x1,x2))}}`;
}

function attributes(source) {
  return Object.fromEntries([...source.matchAll(/([\w:-]+)="([^"]*)"/g)].map(m => [m[1],m[2]]));
}

// Only absolute M/L/Z commands occur in this project's source SVGs.
// Unsupported new paths are rejected instead of silently inventing formulas.
function pathPoints(data) {
  const tokens = data.match(/[a-zA-Z]|[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
  const runs = [];
  let run = null;
  for (let index = 0; index < tokens.length;) {
    const command = tokens[index++];
    if (command === 'Z' || command === 'z') {
      if (!run?.length) throw new Error('Invalid close-path');
      run.push([...run[0]]);
      continue;
    }
    if (command !== 'M' && command !== 'L') throw new Error(`Unsupported SVG command: ${command}`);
    const x = Number(tokens[index++]), y = Number(tokens[index++]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('Invalid SVG coordinates');
    if (command === 'M') {
      run = [[x,y]];
      runs.push(run);
    } else {
      if (!run) throw new Error('Path must start with M');
      run.push([x,y]);
    }
  }
  return runs;
}

function pathEquations(data) {
  return pathPoints(data).flatMap(points => points.slice(1).map((p,i) => lineEquation(...points[i],...p)));
}

function snap(value) {
  const candidate = Math.round(value*1000)/1000;
  return Math.abs(value-candidate) < 0.0001 ? candidate : Number(value.toPrecision(9));
}

function fitArc(points) {
  if (points.length < 3) throw new Error('Arc needs at least three points');
  const [x1,y1] = points[0], [x2,y2] = points[Math.floor(points.length/2)], [x3,y3] = points.at(-1);
  const determinant = 2*(x1*(y2-y3)+x2*(y3-y1)+x3*(y1-y2));
  if (Math.abs(determinant) < EPSILON) throw new Error('Collinear arc');
  const s1=x1*x1+y1*y1, s2=x2*x2+y2*y2, s3=x3*x3+y3*y3;
  const cx=snap((s1*(y2-y3)+s2*(y3-y1)+s3*(y1-y2))/determinant);
  const cy=snap((s1*(x3-x2)+s2*(x1-x3)+s3*(x2-x1))/determinant);
  const radius=snap(Math.hypot(x1-cx,y1-cy));
  const maxResidual=Math.max(...points.map(([x,y]) => Math.abs(Math.hypot(x-cx,y-cy)-radius)));
  if (maxResidual > 0.0001) throw new Error('Path does not follow a circle');

  const near=(a,b)=>Math.abs(a-b)<0.0001;
  let restriction, rangeDescription, region;
  if (near(y1,cy) && near(y3,cy)) {
    const op=y2>cy?'>=':'<=';
    restriction=`y${op}${numberText(cy)}`;
    rangeDescription=`중심보다 ${y2>cy?'위쪽':'아래쪽'} 반원: ${restriction}`;
    region={type:'half',axis:'y',op,value:cy};
  } else if (near(x1,cx) && near(x3,cx)) {
    const op=x2>cx?'>=':'<=';
    restriction=`x${op}${numberText(cx)}`;
    rangeDescription=`중심보다 ${x2>cx?'오른쪽':'왼쪽'} 반원: ${restriction}`;
    region={type:'half',axis:'x',op,value:cx};
  } else if (near(y1,cy+radius/Math.SQRT2) && near(y3,cy+radius/Math.SQRT2)
             && near(Math.abs(x1-cx),radius/Math.SQRT2) && near(Math.abs(x3-cx),radius/Math.SQRT2)
             && y2>y1) {
    const xTerm = Math.abs(cx)<EPSILON?'x':`${cx<0?`x+${numberText(-cx)}`:`x-${numberText(cx)}`}`;
    restriction=`y>=abs(${xTerm})${Math.abs(cy)<EPSILON?'':`${cy<0?'-':'+'}${numberText(Math.abs(cy))}`}`;
    rangeDescription=`위쪽 90° 부채꼴의 원호: ${restriction}`;
    region={type:'top-wedge',cx,cy};
  } else {
    throw new Error('Unsupported arc range; add and test a new model before publishing');
  }
  return {
    type:'arc', cx,cy,radius,region,maxResidual,
    equation:`${circleEquation(cx,cy,radius)}{${restriction}}`,
    restriction,rangeDescription,
    description:`중심 (${numberText(cx)}, ${numberText(cy)}), 반지름 ${numberText(radius)}. ${rangeDescription}`,
  };
}

function shapeModel(part, markup) {
  const circle=markup.match(/<circle\b([^>]*?)\/>/);
  const line=markup.match(/<line\b([^>]*?)\/>/);
  const curve=markup.match(/<path\b([^>]*?)\/>/);
  if ((part.kind==='circle'||part.kind==='point') && circle) {
    const attrs=attributes(circle[1]), cx=Number(attrs.cx),cy=Number(attrs.cy),radius=Number(attrs.r);
    [cx,cy,radius].forEach(numberText);
    if (part.kind==='point') return {
      type:'point',cx,cy,equation:`(${numberText(cx)},${numberText(cy)})`,restriction:'없음',
      description:`점의 좌표는 (${numberText(cx)}, ${numberText(cy)})입니다. 그림의 작은 원은 점을 잘 보이게 하는 표시입니다.`,
    };
    return {
      type:'circle',cx,cy,radius,equation:circleEquation(cx,cy,radius),restriction:'없음 · 원 전체',
      description:`중심 (${numberText(cx)}, ${numberText(cy)}), 반지름 ${numberText(radius)}. 원 전체를 그립니다.`,
    };
  }
  if (part.kind==='line' && line) {
    const a=attributes(line[1]);
    const x1=Number(a.x1),y1=Number(a.y1),x2=Number(a.x2),y2=Number(a.y2);
    const equation=lineEquation(x1,y1,x2,y2);
    return {
      type:'line',x1,y1,x2,y2,equation,
      restriction:equation.match(/\{(.+)\}/)?.[1]||'없음',
      description:`양 끝점 (${numberText(x1)}, ${numberText(y1)})와 (${numberText(x2)}, ${numberText(y2)})를 잇는 선분입니다. 범위 조건도 함께 입력하세요.`,
    };
  }
  if (part.kind==='arc' && curve) {
    const runs=pathPoints(attributes(curve[1]).d||'');
    if (runs.length!==1) throw new Error('Arc must be one continuous path');
    return fitArc(runs[0]);
  }
  throw new Error(`Unsupported shape: ${part.name} (${part.kind})`);
}

function readAppData() {
  const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8');
  const json=html.match(/<script id="app-data" type="application\/json">([\s\S]*?)<\/script>/);
  if (!json) throw new Error('Missing app-data');
  return JSON.parse(json[1]);
}

function buildTeacherData(data=readAppData()) {
  return data.icons.map(icon=>{
    const groups=new Map([...icon.svg.matchAll(/<g\b([^>]*)>([\s\S]*?)<\/g>/g)]
      .map(m=>[Number(attributes(m[1])['data-part']),m[2]]));
    const parts=icon.parts.map((part,index)=>{
      const model=shapeModel(part,groups.get(index)||'');
      return {name:part.name,kind:part.kind,kindLabel:KIND[part.kind],
        equations:[model.equation],description:model.description,restriction:model.restriction,model};
    });
    return {id:icon.id,name:icon.name,subtitle:icon.subtitle,svg:icon.svg,bounds:icon.bounds,
      level:icon.level,focus:icon.focus,counts:icon.counts,parts};
  });
}

module.exports={buildTeacherData,readAppData,lineEquation,pathEquations,pathPoints,fitArc,shapeModel,attributes};
