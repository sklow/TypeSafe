import fitz,sys
# 論文 PDF から結果図を切り出す: python crop_thesis.py figs/thesis  (要 pymupdf, pillow)
from PIL import Image, ImageChops
d=fitz.open('/Users/seigo/Desktop/working/claude/TypeSafeAI/rag/source/最終版.pdf')
sel=[('t_01',69,0),('t_02',74,0),('t_03',72,1),('t_04',73,0),('t_05',75,0),('t_06',77,0),('t_07',81,2),('t_08',68,1),('t_09',55,0),('t_10',88,0)]
out=sys.argv[1]
for name,p,i in sel:
    pg=d[p-1]; b=fitz.Rect(pg.get_image_info()[i]['bbox'])
    b=fitz.Rect(b.x0-6,b.y0-4,b.x1+4,b.y1+4)
    z=1000/max(b.width,b.height)
    pix=pg.get_pixmap(matrix=fitz.Matrix(z,z),clip=b)
    fn=f'{out}/{name}.png'; pix.save(fn)
    im=Image.open(fn).convert('RGB'); bg=Image.new('RGB',im.size,'white')
    bb=ImageChops.difference(im,bg).getbbox(); im=im.crop((max(bb[0]-8,0),max(bb[1]-8,0),min(bb[2]+8,im.width),min(bb[3]+8,im.height)))
    s=1000/max(im.size); im=im.resize((round(im.width*s),round(im.height*s)),Image.LANCZOS); im.save(fn); print(fn,im.size)
