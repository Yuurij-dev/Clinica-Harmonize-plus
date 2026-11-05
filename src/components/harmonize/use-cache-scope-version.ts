import { useEffect, useState } from "react";
import { CLIENT_CACHE_SCOPE_CHANGED_EVENT } from "@/lib/client-cache";

// Muda a cada troca de escopo do cache (usuário/clínica/permissões): efeitos que dependem dele recriam o coordenador de abas.
export function useCacheScopeVersion() {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const onScope = () => setVersion((current) => current + 1);
    window.addEventListener(CLIENT_CACHE_SCOPE_CHANGED_EVENT, onScope);
    return () => window.removeEventListener(CLIENT_CACHE_SCOPE_CHANGED_EVENT, onScope);
  }, []);
  return version;
}
