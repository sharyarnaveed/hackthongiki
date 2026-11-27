import { UI_STORAGE_KEY_CONST } from "./theme-constants";

/**
 * Runs before paint (inlined in <head>) so the persisted mode/theme
 * is applied without a flash. Keep it dependency-free.
 */
export const themeInitScript = `(function(){try{
var s=JSON.parse(localStorage.getItem("${UI_STORAGE_KEY_CONST}")||"{}").state||{};
var m=s.mode==="home"?"home":"office";
var t=s.theme||"system";
var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);
var r=document.documentElement;r.dataset.mode=m;r.classList.toggle("dark",d);r.style.colorScheme=d?"dark":"light";
}catch(e){}})();`;
