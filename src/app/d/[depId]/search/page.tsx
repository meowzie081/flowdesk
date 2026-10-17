import GlobalSearch from '@/components/GlobalSearch';
export default function SearchPage({params}:{params:{depId:string}}){return <GlobalSearch depId={params.depId}/>}
