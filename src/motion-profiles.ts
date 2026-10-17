/** Semantic timing, independent of the monitor's refresh interval. */
export const motionProfiles = {
  responsive: { omega: 40, duration: 130 },
  smooth: { omega: 32, duration: 280 },
  gentle: { omega: 25, duration: 170 },
  expressive: { omega: 28, duration: 240 },
  instant: { omega: 40, duration: 0 },
} as const;
export type MotionProfile = keyof typeof motionProfiles;
export const smoothStep = (value: number): number => {
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
};

/** Retain only keyframes needed for a bounded spatial interpolation error.
 * Sampling resolution is geometry-driven, not a requested presentation rate. */
export function geometryMesh(points:readonly {width:number;height:number;radius:number}[],error=.025):number[] {
  if(points.length<2)return points.map((_,i)=>i);
  const output=[0],span=Math.max(1,Math.floor((points.length-1)*.04));
  const split=(left:number,right:number):void=>{
    if(right-left<=1){output.push(right);return;}
    const a=points[left]!,b=points[right]!;
    let refine=right-left>span;
    for(const fraction of [.25,.5,.75]){
      const index=Math.round(left+(right-left)*fraction),mix=(index-left)/(right-left),point=points[index]!;
      for(const key of ['width','height','radius'] as const){
        if(Math.abs(point[key]-(a[key]+(b[key]-a[key])*mix))>error)refine=true;
      }
    }
    if(refine){const middle=(left+right)>>1;split(left,middle);split(middle,right);}else output.push(right);
  };
  split(0,points.length-1);return output;
}
