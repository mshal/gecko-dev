# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import os
import re

# TODO: ./mpn/generic/addaddmul_1msb0.c only on Linux/Mac, not Win?

def get_operation_define(src):
    # Every file in the gmp/mpn/ directory is built with -DOPERATION=filename,
    # where filename is the file without the extension. Eg: mpn/generic/zero.c
    # is built with -DOPERATION_zero
    basename = os.path.splitext(os.path.basename(src))[0]
    return basename

outfile = open('mpn_moz.build', 'w')
outfile2 = open('mpn2_moz.build', 'w')

for ofile in (outfile, outfile2):
    ofile.write("""# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.


### This moz.build was AUTOMATICALLY GENERATED from config_links.py ###
### DO NOT edit it by hand.                                         ###
""")

sources = {}
sources2 = {}
with open('build/config.status') as f:
    for line in f:
        res = re.match('^config_links="(.*)"', line)
        if res:
            for link in res.group(1).split():
                (linkfrom, linkto) = link.split(':')
                if linkfrom.endswith('.asm'):
                    # TODO: asm
                    continue
                if not linkfrom.endswith('.h'):
                    filename = '../../../../third_party/gmp/%s' % linkto
                    if filename not in sources:
                        sources[filename] = get_operation_define(linkfrom)
                    else:
                        sources2[filename] = get_operation_define(linkfrom)

for ofile, srcs in ((outfile, sources), (outfile2, sources2)):
    ofile.write('gmp_srcs = []\n');
    ofile.write("SOURCES += [\n")
    for src in sorted(srcs):
        ofile.write("    '%s',\n" % src)
    ofile.write("]\n")
    for src in sorted(srcs):
        ofile.write("SOURCES['%s'].flags += ['-DOPERATION_%s']\n" % (src, srcs[src]))
    ofile.write("include('../gmp.mozbuild')\n")
