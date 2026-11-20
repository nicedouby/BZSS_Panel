#include "sha256.h"
#include <stdio.h>
#include <string.h>
static void hex(const unsigned char d[32],char out[65]){static const char h[]="0123456789abcdef";for(int i=0;i<32;i++){out[i*2]=h[d[i]>>4];out[i*2+1]=h[d[i]&15];}out[64]=0;}
int main(int argc,char **argv){
 const char *v[]={"","abc","abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq"};
 const char *want[]={"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855","ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad","248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"};
 unsigned char digest[32],buf[8192];char got[65];nt_sha256 s;
 for(int i=0;i<3;i++){nt_sha256_init(&s);for(size_t j=0;j<strlen(v[i]);j++)nt_sha256_update(&s,v[i]+j,1);nt_sha256_final(&s,digest);hex(digest,got);if(strcmp(got,want[i]))return 1;}
 if(argc==2){FILE *f=fopen(argv[1],"rb");if(!f)return 2;nt_sha256_init(&s);size_t n;while((n=fread(buf,1,sizeof buf,f)))nt_sha256_update(&s,buf,n);if(ferror(f)){fclose(f);return 2;}fclose(f);nt_sha256_final(&s,digest);hex(digest,got);puts(got);}else puts("sha256_vectors_passed");return 0;
}
